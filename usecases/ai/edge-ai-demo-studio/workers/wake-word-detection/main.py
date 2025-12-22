# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Wake Word Detection Service - Main application entry point."""

import argparse
import asyncio
import logging
import os
import shutil
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from pydantic import HttpUrl

from utils.audio_manager import AudioManager
from utils.config import AudioConfig, DetectionState, ServerConfig
from utils.database import create_db_and_tables, get_session
from utils.model_manager import ModelManager
from utils.models import (
    DetectionStartRequest,
    ModelReloadRequest,
    WebhookSubscriber,
    WebhookSubscription,
)
from utils.util import create_cache_directory
from utils.webhook_manager import WebhookManager

logger = logging.getLogger("uvicorn.error")

# Application state (will be initialized in lifespan)
audio_manager: Optional[AudioManager] = None
model_manager: Optional[ModelManager] = None
detection_state: Optional[DetectionState] = None
processing_task: Optional[asyncio.Task] = None

# Temporary storage for CLI args
_initial_model_paths: list[str] = []
_initial_vad_threshold: float = 0.2


async def clean_up():
    """Clean up resources on shutdown."""
    logger.info("Shutting down server ...")
    global processing_task

    if detection_state.active:
        detection_state.active = False
        await audio_manager.stop_stream()

        if processing_task is not None:
            try:
                await asyncio.wait_for(processing_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                processing_task.cancel()
            except Exception as e:
                logger.error(f"Error during cleanup: {e}")

    await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager."""
    global audio_manager, model_manager, detection_state

    logger.info("Initializing server services ...")

    # Initialize managers and state
    audio_config = AudioConfig()
    audio_manager = AudioManager(audio_config)
    model_manager = ModelManager()
    detection_state = DetectionState()
    detection_state.vad_threshold = _initial_vad_threshold

    # Setup database and models
    create_cache_directory("data")
    create_db_and_tables()
    model_manager.download_dependencies()

    # Load initial models if specified
    if _initial_model_paths:
        model_manager.load_models(_initial_model_paths, _initial_vad_threshold)

    yield
    await clean_up()


# Configure application
server_config = ServerConfig.from_env()
app = FastAPI(
    lifespan=lifespan,
    title="Wake Word Detection Webhook Server",
    description="Server that listens to system microphone and sends webhooks when wake words are detected",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=server_config.allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    """
    Webhook that will be called when a wake word is detected.

    The webhook will receive:
    {
        "event": "wake_word_detected",
        "model": "hey_jarvis_v0.1",
        "score": 0.717,
        "timestamp": "2025-11-28T10:30:00.123456",
        "message": "Wake word 'hey_jarvis_v0.1' detected!"
    }
    """
    pass


async def process_audio():
    """Process audio from the queue and detect wake words."""
    logger.info("Audio processing started")

    try:
        while detection_state.active:
            try:
                # Get audio from queue with asyncio
                audio_chunk = await asyncio.wait_for(
                    audio_manager.audio_queue.get(), timeout=0.1
                )

                # Get prediction
                prediction = model_manager.predict(audio_chunk)

                # Check for detections and notify subscribers
                for model_name, score in prediction.items():
                    score_float = float(score)
                    await WebhookManager.notify_subscribers(model_name, score_float)

            except asyncio.TimeoutError:
                # No audio available, continue
                await asyncio.sleep(0.01)
            except Exception as e:
                logger.error(f"Error processing audio: {e}")
                await asyncio.sleep(0.1)

    finally:
        logger.info("Audio processing stopped")


@app.post("/v1/wake-word-detection/webhooks/subscribe")
async def subscribe_webhook(
    subscription: WebhookSubscription, session: Session = Depends(get_session)
):
    """
    Subscribe to wake word detection webhooks.

    Your endpoint will receive POST requests with:
    {
        "event": "wake_word_detected",
        "model": "hey_jarvis_v0.1",
        "score": 0.717,
        "timestamp": "2025-11-28T10:30:00.123456",
        "message": "Wake word 'hey_jarvis_v0.1' detected!"
    }
    """
    url_str = str(subscription.url)

    # Check if URL already subscribed
    existing = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if existing:
        return {"message": "URL already subscribed", "subscription": existing}

    # Add new subscriber
    subscriber = WebhookSubscriber(
        url=url_str,
        name=subscription.name or url_str,
        threshold=subscription.threshold or 0.6,
        api_key=subscription.api_key,
    )
    session.add(subscriber)
    session.commit()
    session.refresh(subscriber)

    print(f"New subscriber: {subscriber.name} ({subscriber.url})")

    total_subscribers = len(session.exec(select(WebhookSubscriber)).all())

    return {
        "message": "Successfully subscribed to wake word detection webhooks",
        "subscription": subscriber,
        "total_subscribers": total_subscribers,
    }


@app.patch("/v1/wake-word-detection/webhooks/subscriber")
async def update_subscriber(
    subscription: WebhookSubscription,
    session: Session = Depends(get_session),
):
    """Update an existing webhook subscriber by URL."""
    url_str = str(subscription.url)

    # Find the subscriber by URL
    subscriber = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if not subscriber:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    # Update fields
    if subscription.name is not None:
        subscriber.name = subscription.name
    if subscription.threshold is not None:
        subscriber.threshold = subscription.threshold
    if subscription.api_key is not None:
        subscriber.api_key = subscription.api_key

    session.add(subscriber)
    session.commit()
    session.refresh(subscriber)

    print(f"Subscriber updated: {subscriber.name} ({subscriber.url})")

    return {
        "message": "Subscriber updated successfully",
        "subscription": subscriber,
    }


@app.delete("/v1/wake-word-detection/webhooks/unsubscribe")
async def unsubscribe_webhook(url: HttpUrl, session: Session = Depends(get_session)):
    """Unsubscribe from wake word detection webhooks."""
    url_str = str(url)

    # Find and delete subscriber
    subscriber = session.exec(
        select(WebhookSubscriber).where(WebhookSubscriber.url == url_str)
    ).first()

    if not subscriber:
        raise HTTPException(status_code=404, detail="Subscription not found")

    session.delete(subscriber)
    session.commit()

    print(f"Subscriber removed: {url_str}")

    remaining_count = len(session.exec(select(WebhookSubscriber)).all())

    return {
        "message": "Successfully unsubscribed",
        "url": url_str,
        "remaining_subscribers": remaining_count,
    }


@app.get("/v1/wake-word-detection/webhooks/subscribers")
async def list_subscribers(session: Session = Depends(get_session)):
    """List all active webhook subscribers."""
    subscribers = session.exec(select(WebhookSubscriber)).all()
    return {"subscribers": subscribers, "total": len(subscribers)}


@app.get("/v1/wake-word-detection/audio-devices")
async def list_audio_devices():
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
    session: Session = Depends(get_session),
):
    """Start listening for wake words on the server's microphone.

    Args:
        request: Optional request body containing device_id for audio input selection
    """
    global processing_task

    if detection_state.active:
        return {"message": "Detection already active", "status": "running"}

    # Check if there are any subscribers
    subscribers = session.exec(select(WebhookSubscriber)).all()
    if not subscribers:
        raise HTTPException(
            status_code=400,
            detail="No subscribers registered. Subscribe to webhooks first.",
        )

    detection_state.active = True
    detection_state.selected_device_id = request.device_id

    # Start audio stream with selected device
    await audio_manager.start_stream(
        device_id=(
            request.device_id
            if request.device_id != detection_state.default_device_id
            else -1  # use -1 for sysdefault
        )
    )

    # Start audio processing as a background task
    processing_task = asyncio.create_task(process_audio())

    device_info = (
        f"device {request.device_id}" if request.device_id != -1 else "default device"
    )
    logger.info(f"Wake word detection started with {device_info}")

    return {
        "message": "Wake word detection started",
        "status": "running",
        "subscribers": len(subscribers),
        "models": model_manager.get_model_names(),
        "device_id": request.device_id,
    }


@app.post("/v1/wake-word-detection/stop")
async def stop_detection():
    """Stop listening for wake words."""
    global processing_task

    if not detection_state.active:
        return {"message": "Detection not active", "status": "stopped"}

    detection_state.active = False

    # Stop the audio stream
    await audio_manager.stop_stream()

    # Wait for processing task to complete
    if processing_task is not None:
        try:
            await asyncio.wait_for(processing_task, timeout=2.0)
        except asyncio.TimeoutError:
            processing_task.cancel()
        except Exception as e:
            logger.error(f"Error stopping processing task: {e}")
        finally:
            processing_task = None

    # Clear the audio queue
    audio_manager.clear_queue()

    logger.info("Wake word detection stopped")

    return {"message": "Wake word detection stopped", "status": "stopped"}


@app.post("/v1/wake-word-detection/models/upload")
async def upload_model(file: UploadFile = File(...)):
    """
    Upload a custom wake word model (ONNX format).

    Args:
        file: The ONNX model file to upload

    The model will be saved to models/wake-word-detection/ directory.
    Use /models/reload endpoint to load it.
    """
    # Validate file extension
    if not file.filename.endswith(".onnx"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Only .onnx files are supported.",
        )

    # Get model directory
    model_dir = ModelManager.get_model_directory()

    # Create the directories if they don't exist
    create_cache_directory(model_dir)

    # Save the file
    file_path = os.path.join(model_dir, file.filename)

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
async def reload_models(request: ModelReloadRequest):
    """
    Reload wake word models dynamically without restarting the server.

    Args:
        request: ModelReloadRequest containing model_filenames and vad_threshold

    Note: Detection must be stopped before reloading models.
    """
    # Check if detection is active
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
async def list_models():
    """List all available wake word models in the models directory."""
    models = model_manager.list_available_models()

    return {
        "models": models,
        "loaded_models": model_manager.get_model_names(),
    }


@app.delete("/v1/wake-word-detection/models/delete/{filename}")
async def delete_model(filename: str):
    """Delete a wake word model from the models directory."""
    # Validate filename
    if not filename.endswith(".onnx"):
        raise HTTPException(
            status_code=400,
            detail="Invalid filename. Only .onnx files can be deleted.",
        )

    # Check if detection is active
    if detection_state.active:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete models while detection is active. Stop detection first.",
        )

    # Check if model is currently loaded
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
async def test_webhook():
    """Send a test webhook to all subscribers."""
    results = await WebhookManager.send_test_webhook()

    if not results:
        raise HTTPException(status_code=400, detail="No subscribers registered")

    return {"message": "Test webhooks sent", "results": results}


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Wake Word Detection Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=5007,
        help="Port for the worker to listen on",
    )
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
    return parser.parse_args()


def main():
    """Main entry point for the wake word detection service."""
    global _initial_model_paths, _initial_vad_threshold

    args = parse_args()

    # Process model paths
    if args.models:
        _initial_model_paths = [
            ModelManager.resolve_model_path(model) for model in args.models
        ]
        print(f"Loading models: {_initial_model_paths}")
    else:
        # Default to hey_jarvis_v0.1 if no models specified
        print("No models specified, using default: hey_jarvis_v0.1.onnx")
        default_model_path = ModelManager.resolve_model_path("hey_jarvis_v0.1.onnx")
        _initial_model_paths = [default_model_path]
        print(f"Default model loaded: {default_model_path}")

    # Store VAD threshold
    _initial_vad_threshold = args.vad_threshold

    # Get server config
    config = ServerConfig.from_env(args.port)

    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
    )


if __name__ == "__main__":
    main()
