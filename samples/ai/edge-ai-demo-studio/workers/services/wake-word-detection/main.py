# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
import os
import shutil
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from sqlmodel import Session, select

from pydantic import HttpUrl
from worker_common import base_parser, create_app, serve, sse_event, sse_response
from worker_common.audio import decode_to_pcm16

from utils.audio_manager import AudioManager, MicrophoneUnavailableError
from utils.config import AudioConfig, DetectionState
from utils.database import DATA_DIR, create_db_and_tables, get_session
from utils.detection_events import DetectionEventLog
from utils.detection_runner import DetectionRunner
from utils.model_manager import CLIP_PADDING_SECONDS, ModelManager
from utils.models import (
    DetectionStartRequest,
    ModelReloadRequest,
    WebhookSubscriber,
    WebhookSubscription,
)
from utils.util import create_cache_directory
from utils.webhook_manager import WebhookManager

logger = logging.getLogger("uvicorn.error")

# Set in lifespan.
audio_manager: Optional[AudioManager] = None
model_manager: Optional[ModelManager] = None
detection_state: Optional[DetectionState] = None
detection_runner: Optional[DetectionRunner] = None

# Recent detections, for the demo UI.
MAX_EVENTS = 200
detection_events = DetectionEventLog(MAX_EVENTS)
webhook_manager = WebhookManager()

# Start and stop each take a few awaits; one at a time keeps a stop from landing while a start
# is still opening the microphone.
_detection_lock = asyncio.Lock()

# Seconds between `level` events on the event stream while detection runs.
LEVEL_INTERVAL = 0.1

# From the command line, applied in lifespan.
_initial_model_paths: list[str] = []
_initial_vad_threshold: float = 0.2
# Input device this instance opens by default (-1 = system default). Lets two
# instances each keep their own microphone across restarts.
_initial_device_id: int = -1


async def _stop_detection():
    """Stop the microphone and the detection thread (``detection_state.active`` already cleared)."""
    await audio_manager.stop_stream()
    if not await asyncio.to_thread(detection_runner.stop, 2.0):
        logger.warning("Detection thread is still finishing a chunk")
    audio_manager.clear_queue()


async def clean_up():
    """Clean up resources on shutdown."""
    logger.info("Shutting down server ...")

    if detection_state.active:
        detection_state.active = False
        try:
            await _stop_detection()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
    webhook_manager.close()

    await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global audio_manager, model_manager, detection_state, detection_runner

    logger.info("Initializing server services ...")

    audio_config = AudioConfig()
    audio_manager = AudioManager(audio_config)
    model_manager = ModelManager()
    detection_state = DetectionState()
    detection_state.vad_threshold = _initial_vad_threshold
    if _initial_device_id != -1:
        detection_state.selected_device_id = _initial_device_id
    detection_runner = DetectionRunner(
        audio_manager, model_manager, detection_state, detection_events, webhook_manager
    )

    create_cache_directory(str(DATA_DIR))
    create_db_and_tables()
    model_manager.download_dependencies()

    if _initial_model_paths:
        model_manager.load_models(_initial_model_paths, _initial_vad_threshold)

    yield
    await clean_up()


# healthcheck=False: the demo page reads this worker's own JSON /healthcheck (models, detection state).
app = create_app(
    "Wake Word Detection Webhook Server",
    lifespan=lifespan,
    healthcheck=False,
    description="Server that listens to system microphone and sends webhooks when wake words are detected",
)


@app.get("/healthcheck", status_code=200)
def get_healthcheck(session: Session = Depends(get_session)):
    """Health check endpoint."""
    subscribers_count = len(session.exec(select(WebhookSubscriber)).all())
    return {
        "status": "running",
        "model_loaded": model_manager.model is not None,
        "models": model_manager.get_model_names(),
        "detection_active": detection_state.active,
        "subscribers": subscribers_count,
    }


@app.webhooks.post("new-detection")
def new_detection_webhook(body: dict):
    """Called when a wake word is detected, with:

    {
        "event": "wake_word_detected",
        "model": "hey_jarvis_v0.1",
        "score": 0.717,
        "timestamp": "2025-11-28T10:30:00.123456",
        "message": "Wake word 'hey_jarvis_v0.1' detected!"
    }
    """
    pass


@app.post("/v1/wake-word-detection/webhooks/subscribe")
def subscribe_webhook(
    subscription: WebhookSubscription, session: Session = Depends(get_session)
):
    """Subscribe a URL to detections; it gets POSTs shaped like the `new-detection` webhook."""
    url_str = str(subscription.url)

    existing = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if existing:
        return {"message": "URL already subscribed", "subscription": existing}

    subscriber = WebhookSubscriber(
        url=url_str,
        name=subscription.name or url_str,
        threshold=subscription.threshold or 0.6,
        api_key=subscription.api_key,
    )
    session.add(subscriber)
    session.commit()
    session.refresh(subscriber)
    webhook_manager.invalidate()

    print(f"New subscriber: {subscriber.name} ({subscriber.url})")

    total_subscribers = len(session.exec(select(WebhookSubscriber)).all())

    return {
        "message": "Successfully subscribed to wake word detection webhooks",
        "subscription": subscriber,
        "total_subscribers": total_subscribers,
    }


@app.patch("/v1/wake-word-detection/webhooks/subscriber")
def update_subscriber(
    subscription: WebhookSubscription,
    session: Session = Depends(get_session),
):
    """Update an existing webhook subscriber by URL."""
    url_str = str(subscription.url)

    subscriber = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if not subscriber:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    if subscription.name is not None:
        subscriber.name = subscription.name
    if subscription.threshold is not None:
        subscriber.threshold = subscription.threshold
    if subscription.api_key is not None:
        subscriber.api_key = subscription.api_key

    session.add(subscriber)
    session.commit()
    session.refresh(subscriber)
    webhook_manager.invalidate()

    print(f"Subscriber updated: {subscriber.name} ({subscriber.url})")

    return {
        "message": "Subscriber updated successfully",
        "subscription": subscriber,
    }


@app.delete("/v1/wake-word-detection/webhooks/unsubscribe")
def unsubscribe_webhook(url: HttpUrl, session: Session = Depends(get_session)):
    """Unsubscribe from wake word detection webhooks."""
    url_str = str(url)

    subscriber = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if not subscriber:
        raise HTTPException(status_code=404, detail="Subscription not found")

    session.delete(subscriber)
    session.commit()
    webhook_manager.invalidate()

    print(f"Subscriber removed: {url_str}")

    remaining_count = len(session.exec(select(WebhookSubscriber)).all())

    return {
        "message": "Successfully unsubscribed",
        "url": url_str,
        "remaining_subscribers": remaining_count,
    }


@app.get("/v1/wake-word-detection/webhooks/subscribers")
def list_subscribers(session: Session = Depends(get_session)):
    """List all active webhook subscribers."""
    subscribers = session.exec(select(WebhookSubscriber)).all()
    return {"subscribers": subscribers, "total": len(subscribers)}


def _audio_level() -> dict:
    if not detection_state.active:
        return {"level": 0.0, "active": False}
    return {"level": audio_manager.current_rms, "active": True}


@app.get("/v1/wake-word-detection/audio-level")
async def get_audio_level():
    """Get the current audio input RMS level (0.0–1.0)."""
    return _audio_level()


@app.get("/v1/wake-word-detection/events")
async def get_detection_events(since: str = ""):
    """Recent detection events, newest first; with ``since`` (ISO timestamp), only later ones."""
    return {"events": detection_events.recent(since)}


@app.get("/v1/wake-word-detection/events/stream")
async def stream_detection_events(since: str = ""):
    """SSE: ``events`` (as GET /events), then each ``detection``, ``cleared`` and ``level`` (10/s)."""
    return sse_response(_detection_event_stream(since))


async def _detection_event_stream(since: str):
    buffered, stream = detection_events.subscribe(since)
    try:
        yield sse_event({"events": buffered}, event="events")
        loop = asyncio.get_running_loop()
        last_level = None
        next_level = loop.time()
        while True:
            wait = next_level - loop.time()
            if wait > 0:
                item = await stream.next(wait)
                if item is not None:
                    name, data = item
                    yield sse_event(data, event=name)
                    continue
            next_level = loop.time() + LEVEL_INTERVAL
            level = _audio_level()
            if level["active"] or level != last_level:
                last_level = level
                yield sse_event(level, event="level")
    finally:
        detection_events.unsubscribe(stream)


@app.delete("/v1/wake-word-detection/events")
async def clear_detection_events():
    """Clear the in-memory detection event buffer."""
    detection_events.clear()
    return {"ok": True}


@app.post("/v1/wake-word-detection/events/test")
async def generate_test_event():
    """Generate a test detection event in the local event buffer."""
    detection_events.record("test", 0.999, threshold=0.0)
    return {"ok": True, "message": "Test event created"}


# Plain `def`: listing devices re-initializes PortAudio and runs `arecord`,
# so FastAPI runs it in its threadpool.
@app.get("/v1/wake-word-detection/audio-devices")
def list_audio_devices():
    """List available audio input devices (microphones)."""
    try:
        available_devices = audio_manager.list_devices(
            detection_state.default_device_id
        )

        return {
            "devices": available_devices,
            "selected_device_id": detection_state.selected_device_id,
            "total": len(available_devices),
        }
    except Exception as e:
        logger.error(f"Error listing audio devices: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list audio devices: {str(e)}",
        )


@app.post("/v1/wake-word-detection/start")
async def start_detection(
    request: DetectionStartRequest = DetectionStartRequest(),
):
    """Start listening for wake words on the server's microphone."""
    async with _detection_lock:
        if detection_state.active:
            return {"message": "Detection already active", "status": "running"}

        # Kept only once it opens: a microphone that is not there must not
        # become the one every later start asks for.
        device_id = (
            request.device_id
            if request.device_id is not None
            else detection_state.selected_device_id
        )
        detection_state.detection_threshold = request.threshold

        try:
            detection_runner.start()
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))
        detection_state.active = True
        try:
            await audio_manager.start_stream(
                device_id=(
                    device_id
                    if device_id != detection_state.default_device_id
                    else -1  # sysdefault
                )
            )
        except Exception as e:
            detection_state.active = False
            await asyncio.to_thread(detection_runner.stop, 2.0)
            if isinstance(e, MicrophoneUnavailableError):
                raise HTTPException(status_code=503, detail=str(e))
            raise HTTPException(status_code=500, detail=f"Failed to open the microphone: {e}")
        detection_state.selected_device_id = device_id

    device_info = (
        f"device {request.device_id}" if request.device_id != -1 else "default device"
    )
    logger.info(f"Wake word detection started with {device_info}")

    subscribers = await asyncio.to_thread(webhook_manager.get_subscriber_count)

    return {
        "message": "Wake word detection started",
        "status": "running",
        "subscribers": subscribers,
        "models": model_manager.get_model_names(),
        "device_id": request.device_id,
    }


@app.post("/v1/wake-word-detection/stop")
async def stop_detection():
    """Stop listening for wake words."""
    async with _detection_lock:
        if not detection_state.active:
            return {"message": "Detection not active", "status": "stopped"}

        detection_state.active = False
        await _stop_detection()

    logger.info("Wake word detection stopped")

    return {"message": "Wake word detection stopped", "status": "stopped"}


# Plain `def`: decoding and scoring a whole recording blocks, so FastAPI runs
# it in its threadpool.
@app.post("/v1/wake-word-detection/detect")
def detect_in_recording(
    file: UploadFile = File(...),
    threshold: float = Form(0.5),
):
    """Score a recording, leaving live detection and webhooks alone: best score, first ``threshold`` hit."""
    if not 0.0 <= threshold <= 1.0:
        raise HTTPException(status_code=400, detail="threshold must be between 0 and 1")
    sample_rate = AudioConfig.SAMPLE_RATE
    try:
        pcm = decode_to_pcm16(file.file.read(), sample_rate)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        file.file.close()
    samples = np.frombuffer(pcm, dtype=np.int16)
    if samples.size == 0:
        raise HTTPException(status_code=400, detail="The recording has no audio")

    try:
        scores = model_manager.score_clip(samples)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))

    duration = samples.size / sample_rate
    step_seconds = AudioConfig.CHUNK_SIZE / sample_rate
    results = []
    for name, steps in scores.items():
        first = next((i for i, score in enumerate(steps) if score >= threshold), None)
        results.append(
            {
                "model": name,
                "max_score": max(steps, default=0.0),
                "detected": first is not None,
                "detected_at": (
                    None
                    if first is None
                    else round(
                        min(duration, max(0.0, (first + 1) * step_seconds - CLIP_PADDING_SECONDS)),
                        2,
                    )
                ),
            }
        )
    return {"duration": round(duration, 2), "threshold": threshold, "results": results}


# The model endpoints below are plain `def`: they write, download and load
# ONNX models, which blocks, so FastAPI runs them in its threadpool.
@app.post("/v1/wake-word-detection/models/upload")
def upload_model(file: UploadFile = File(...)):
    """Upload a custom ONNX wake word model; load it with /models/reload."""
    if not file.filename.endswith(".onnx"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Only .onnx files are supported.",
        )

    model_dir = ModelManager.get_model_directory()

    create_cache_directory(model_dir)

    # Bare name only: never outside the model directory.
    file_path = os.path.join(model_dir, os.path.basename(file.filename))

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        response = {
            "status": True,
            "message": "Model uploaded successfully",
            "filename": file.filename,
            "path": file_path,
        }

        logger.info(f"Model uploaded: {file.filename} to {file_path}")

        return response
    except Exception as e:
        logger.error(f"Error uploading model: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save model: {str(e)}",
        )
    finally:
        file.file.close()


@app.post("/v1/wake-word-detection/models/reload")
def reload_models(request: ModelReloadRequest):
    """Reload wake word models without a restart; detection must be stopped first."""
    if detection_state.active:
        raise HTTPException(
            status_code=409,
            detail="Cannot reload models while detection is active. Stop detection first.",
        )

    try:
        model_manager.reload_models(request.model_filenames, request.vad_threshold)

        return {
            "message": "Models reloaded successfully",
            "loaded_models": model_manager.get_model_names(),
            "model_paths": model_manager.model_paths,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reload models: {str(e)}",
        )


@app.get("/v1/wake-word-detection/models/list")
def list_models():
    """List all available wake word models in the models directory."""
    models = model_manager.list_available_models()

    return {
        "models": models,
        "loaded_models": model_manager.get_model_names(),
    }


@app.delete("/v1/wake-word-detection/models/delete/{filename}")
def delete_model(filename: str):
    """Delete a wake word model from the models directory."""
    if not filename.endswith(".onnx"):
        raise HTTPException(
            status_code=400,
            detail="Invalid filename. Only .onnx files can be deleted.",
        )

    if detection_state.active:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete models while detection is active. Stop detection first.",
        )

    if model_manager.is_model_loaded(filename):
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a model that is currently loaded. Reload with different models first.",
        )

    model_dir = ModelManager.get_model_directory()
    file_path = os.path.join(model_dir, filename)

    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=404,
            detail=f"Model not found: {filename}",
        )

    try:
        os.remove(file_path)
        return {
            "message": "Model deleted successfully",
            "filename": filename,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete model: {str(e)}",
        )


@app.post("/v1/wake-word-detection/webhooks/test-webhook")
def test_webhook():
    """Send a test webhook to all subscribers (threadpool: waits on their responses)."""
    results = webhook_manager.send_test_webhook()

    if not results:
        raise HTTPException(status_code=400, detail="No subscribers registered")

    return {"message": "Test webhooks sent", "results": results}


def parse_args():
    parser = base_parser("Wake Word Detection Worker", default_port=5007, device=False)
    parser.add_argument(
        "--models",
        type=str,
        nargs="+",
        help="List of wake word model files (ONNX format). Can be absolute paths or filenames in models/wake-word-detection/",
    )
    parser.add_argument(
        "--vad-threshold",
        type=float,
        default=0.2,
        help="VAD threshold for voice activity detection (0.0 to 1.0)",
    )
    parser.add_argument(
        "--audio-device",
        type=int,
        default=-1,
        help="Audio input device id this instance opens by default (-1 = system default); "
        "see /v1/wake-word-detection/audio-devices",
    )
    return parser.parse_args()


def main():
    global _initial_model_paths, _initial_vad_threshold, _initial_device_id

    args = parse_args()

    if args.models:
        _initial_model_paths = [
            ModelManager.resolve_model_path(model) for model in args.models
        ]
        print(f"Loading models: {_initial_model_paths}")
    else:
        print("No models specified, using default: hey_jarvis_v0.1.onnx")
        default_model_path = ModelManager.resolve_model_path("hey_jarvis_v0.1.onnx")
        _initial_model_paths = [default_model_path]
        print(f"Default model loaded: {default_model_path}")

    _initial_vad_threshold = args.vad_threshold
    _initial_device_id = args.audio_device

    serve(app, args)


if __name__ == "__main__":
    main()
