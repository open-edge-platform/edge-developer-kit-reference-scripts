# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Speech to Text worker for MERaLiON-3-3B-ASR on OpenVINO (``../oep`` and ``../ovms`` are the other backends).

MERaLiON-3-3B-ASR (A*STAR I2R) transcribes Singapore and Southeast Asian speech: English (incl. Singlish),
Mandarin, Malay, Tamil, Indonesian, Thai, Vietnamese, Cantonese and Hokkien, and code-switching between
them. It detects the language itself, so ``language`` is accepted and ignored. The routes are the OVMS
backend's: batch transcription in five formats and ``WS /v1/audio/stream`` (VAD-segmented live input).
"""

from __future__ import annotations

import argparse
import asyncio
import io
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

import numpy as np
import soundfile as sf
from audio_input_stream import get_silero_model, handle_audio_stream
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse

import ov_meralion
from worker_common import (
    base_parser,
    create_app,
    get_logger,
    install_models_routes,
    install_openai_errors,
    normalize_openvino_device,
    serve,
    server_timing,
    timed,
)
from worker_common.audio import decode_to_pcm16
from worker_common.startup import startup_stage
from worker_common.transcripts import (
    RESPONSE_FORMATS,
    granularities,
    normalize_segments,
    parse_bool,
    to_srt,
    to_vtt,
)

SERVICE_ID = "speech-to-text"
BACKEND = "meralion"
DEFAULT_PORT = 8023

logger = get_logger(SERVICE_ID)

CONFIG: dict[str, Any] = {
    "port": DEFAULT_PORT,
    "device": "AUTO",
    "precision": "int8",
    "source": "huggingface",
}
STATE: dict[str, Any] = {"ready": False, "error": None, "startup_seconds": None}
MODEL: Optional[ov_meralion.MeralionASR] = None
# Silero VAD for /v1/audio/stream; loaded at startup, retried on first use.
VAD_MODEL = None
VAD_LOCK = asyncio.Lock()


def _load() -> ov_meralion.MeralionASR:
    checkpoint = ov_meralion.download(CONFIG["source"])
    irs = ov_meralion.ensure_export(checkpoint, CONFIG["precision"])
    with startup_stage("loading-model", f"{ov_meralion.MODEL_ID} on {CONFIG['device']}"):
        model = ov_meralion.MeralionASR(checkpoint, irs, CONFIG["device"])
        # The first chunk compiles kernels for the decoder's shapes: pay for it here, not on a request.
        model.transcribe(np.zeros(ov_meralion.SAMPLE_RATE, np.float32))
    return model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global MODEL
    started = time.monotonic()
    logger.info(
        "Loading %s on %s (%s weights) ...", ov_meralion.MODEL_ID, CONFIG["device"], CONFIG["precision"]
    )
    try:
        MODEL = await asyncio.to_thread(_load)
    except Exception as exc:
        STATE["error"] = f"{type(exc).__name__}: {exc}"
        logger.error("Failed to initialize MERaLiON: %s", exc)
        raise
    # The VAD only serves live streaming: a failure here is logged and retried
    # when a stream connects, never a reason to refuse batch transcription.
    try:
        await _ensure_vad_model()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Silero VAD not loaded (live streaming unavailable for now): %s", exc)
    STATE["ready"] = True
    STATE["startup_seconds"] = round(time.monotonic() - started, 2)
    logger.info("MERaLiON ready in %ss (encoder on %s, decoder on %s)", STATE["startup_seconds"],
                MODEL.devices["encoder"], MODEL.devices["decoder"])
    yield
    STATE["ready"] = False


app = create_app("speech-to-text (MERaLiON)", lifespan=lifespan, healthcheck=False)


@app.get("/healthcheck", include_in_schema=False)
def get_healthcheck() -> JSONResponse:
    """The other backends' shape: 503 until the model is loaded."""
    ready = bool(STATE["ready"])
    body: dict[str, Any] = {
        "status": "ok" if ready else "starting",
        "service": SERVICE_ID,
        "backend": BACKEND,
        "upstream": "openvino",
        "active_model": ov_meralion.MODEL_ID,
        "device": CONFIG["device"],
        "port": CONFIG["port"],
        "model_loaded": ready,
    }
    if MODEL is not None:
        body["devices"] = MODEL.devices
    if STATE["startup_seconds"] is not None:
        body["startup_seconds"] = STATE["startup_seconds"]
    if STATE["error"]:
        body["status"] = "error"
        body["error"] = STATE["error"]
    return JSONResponse(body, status_code=200 if ready else 503)


@app.get("/v1/model-info")
def get_model_info() -> dict[str, Any]:
    return {
        "model": ov_meralion.MODEL_ID,
        "provider": BACKEND,
        "device": CONFIG["device"],
        "weight_format": CONFIG["precision"],
        "capabilities": {
            "streaming": False,
            "realtime": False,
            "audio_stream": True,
            "denoise": False,
            "translation": False,
        },
    }


# Live audio stream

async def _ensure_vad_model():
    """The shared Silero VAD model, loaded once (``get_silero_model`` caches it)."""
    global VAD_MODEL
    async with VAD_LOCK:
        if VAD_MODEL is None:
            logger.info("Loading Silero VAD for live audio streaming ...")
            VAD_MODEL = await asyncio.to_thread(get_silero_model)
    return VAD_MODEL


def _transcribe_utterance(pcm: np.ndarray, _language: str) -> str:
    """One live utterance (16 kHz mono int16) -> its text (blocking)."""
    audio = pcm.astype(np.float32) / 32768.0
    return " ".join(s.text for s in MODEL.transcribe(audio))


@app.websocket("/v1/audio/stream")
async def audio_stream(websocket: WebSocket) -> None:
    """Pseudo-streaming transcription of a live microphone (protocol: ``audio_input_stream.stream``).

    Browsers connect to the worker port directly; the app's proxy only forwards HTTP.
    """
    if not STATE["ready"]:
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "message": "The speech-to-text model is still loading; try again shortly."}
        )
        # 1013: "try again later".
        await websocket.close(code=1013)
        return
    try:
        vad_model = await _ensure_vad_model()
    except Exception as exc:  # noqa: BLE001
        logger.error("Silero VAD unavailable: %s", exc)
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": f"Voice activity detection unavailable: {exc}"})
        await websocket.close(code=1011)
        return
    await handle_audio_stream(websocket, vad_model=vad_model, transcribe=_transcribe_utterance)


# OpenAI-compatible audio routes

def _decode(raw: bytes) -> np.ndarray:
    """An upload as 16 kHz mono float32: soundfile for WAV/FLAC/OGG, ffmpeg for the rest (webm, mp3, ...)."""
    try:
        data, rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:  # noqa: BLE001 - not a container soundfile reads
        pcm = decode_to_pcm16(raw, ov_meralion.SAMPLE_RATE)
        return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    mono = data.mean(axis=1)
    if rate == ov_meralion.SAMPLE_RATE:
        return mono
    from math import gcd

    from scipy.signal import resample_poly

    g = gcd(int(rate), ov_meralion.SAMPLE_RATE)
    return resample_poly(mono, ov_meralion.SAMPLE_RATE // g, int(rate) // g).astype(np.float32)


@app.post("/v1/audio/transcriptions", tags=["OpenAI-compatible"])
async def transcription(
    response: Response,
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),  # OpenAI compatibility; MERaLiON-3-3B-ASR is used
    language: Optional[str] = Form(None),  # the model detects the language
    response_format: Optional[str] = Form("json"),
    prompt: Optional[str] = Form(None),  # the model's prompt is fixed
    temperature: Optional[float] = Form(None),  # decoding is greedy
    timestamp_granularities: Optional[list[str]] = Form(None, alias="timestamp_granularities[]"),
    stream: Optional[str] = Form(None),
    return_timestamps: Optional[str] = Form(None),
):
    del model, language, prompt
    fmt = (response_format or "json").strip().lower()
    if fmt not in RESPONSE_FORMATS:
        raise HTTPException(status_code=400, detail=f"response_format must be one of {', '.join(RESPONSE_FORMATS)}")
    if parse_bool(stream):
        raise HTTPException(
            status_code=400,
            detail="Streaming is not available on the MERaLiON backend; switch the "
            "Speech to Text service to the OEP backend for stream=true.",
        )
    if temperature is not None and not 0.0 <= temperature <= 1.0:
        raise HTTPException(status_code=400, detail="temperature must be between 0 and 1")
    wanted = granularities(timestamp_granularities)
    if wanted and fmt != "verbose_json":
        raise HTTPException(status_code=400, detail="timestamp_granularities[] requires response_format=verbose_json")
    if "word" in wanted:
        raise HTTPException(status_code=400, detail="MERaLiON gives no word timestamps; ask for 'segment' only")
    try:
        audio = await asyncio.to_thread(_decode, await file.read())
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the audio: {error}")
    try:
        with timed() as clock:
            parts = await asyncio.to_thread(MODEL.transcribe, audio)
    except Exception as error:  # noqa: BLE001 - surfaced as 500 with the reason
        logger.error("Error in STT transcription: %s", error)
        raise HTTPException(status_code=500, detail=f"Failed to transcribe the voice input. Error: {error}")
    # Model time only (not the decode), for the app's Live metrics.
    response.headers.update(server_timing(clock.seconds))
    text = " ".join(p.text for p in parts)
    duration = round(audio.size / ov_meralion.SAMPLE_RATE, 3)
    # One segment per 30 s chunk: the model gives no finer timestamps.
    segments = normalize_segments([{"start": p.start, "end": p.end, "text": p.text} for p in parts])
    if fmt == "text":
        return PlainTextResponse(text)
    if fmt == "srt":
        return PlainTextResponse(to_srt(segments, text), media_type="text/plain; charset=utf-8")
    if fmt == "vtt":
        return PlainTextResponse(to_vtt(segments, text), media_type="text/vtt; charset=utf-8")
    # `status` isn't OpenAI's, but the demo reads it; `duration` is on every JSON answer for Live metrics.
    if fmt == "verbose_json":
        # The model does not say which language it heard.
        return {"task": "transcribe", "language": None, "duration": duration, "text": text, "status": True,
                "segments": segments}
    body: dict[str, Any] = {"text": text, "status": True, "duration": duration}
    if "segment" in wanted or parse_bool(return_timestamps):
        body["segments"] = segments
    return body


@app.post("/v1/audio/translations", tags=["OpenAI-compatible"])
async def translation():
    raise HTTPException(
        status_code=400,
        detail=f"{ov_meralion.MODEL_ID} only transcribes. Switch the Speech to Text service to the OpenVINO "
        "Model Server backend with a Whisper model to translate to English.",
    )


def _served_models() -> list[str]:
    """``GET /v1/models``: the model plus ``whisper-1`` (OpenAI clients' default id); the routes ignore ``model``."""
    return [ov_meralion.MODEL_ID, "whisper-1"]


install_models_routes(app, _served_models, owned_by="MERaLiON")
install_openai_errors(app)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = base_parser(
        "Speech-to-Text Worker (MERaLiON-3-3B-ASR on OpenVINO)",
        default_port=DEFAULT_PORT,
        default_device="AUTO",
        device_help=(
            "OpenVINO device: AUTO (OpenVINO selects: a discrete GPU, then an integrated GPU, then the "
            "CPU), CPU, GPU, GPU.<n>, NPU (the speech encoder; the decoder then runs on the CPU)"
        ),
        source=True,
    )
    parser.add_argument(
        "--model",
        default=ov_meralion.MODEL_ID,
        help=f"Only {ov_meralion.MODEL_ID} (accepted for the app's common arguments)",
    )
    parser.add_argument(
        "--precision",
        default="int8",
        choices=list(ov_meralion.PRECISIONS),
        help="Decoder weights exported on first start (default: int8; int4 is faster on a GPU and less accurate)",
    )
    # parse_known_args so an unrecognised flag from buildArgs degrades to a warning rather than killing the worker.
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        logger.warning("ignoring unrecognised arguments: %s", " ".join(unknown))
    return args


def main() -> int:
    args = parse_args()
    if args.model != ov_meralion.MODEL_ID:
        logger.error("This backend serves %s only, not %s", ov_meralion.MODEL_ID, args.model)
        return 2
    CONFIG["port"] = args.port
    CONFIG["device"] = normalize_openvino_device(args.device)
    CONFIG["precision"] = args.precision
    CONFIG["source"] = args.source
    serve(app, args, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
