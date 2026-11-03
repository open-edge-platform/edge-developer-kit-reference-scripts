# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Speech to Text worker on OpenVINO Model Server (``../oep`` is the other backend).

Whisper or Qwen3-ASR runs in OVMS on an internal port; this worker fronts it with the OEP backend's
OpenAI-style routes plus ``use_denoise`` and ``WS /v1/audio/stream`` (VAD-segmented live
transcription). OVMS transcribes whole utterances, so there is no ``stream=true`` or ``/v1/realtime``.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import time
import uuid
import wave
from contextlib import asynccontextmanager
from typing import Any, Optional

import numpy as np
import requests as http_requests
from audio_input_stream import get_silero_model, handle_audio_stream, pcm_to_wav_bytes
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse

from modules.audio import ensure_wav
from modules.denoise import denoise, download_omz_model, load_denoise_model
from modules.stt_ovms import (
    cleanup_ovms_process,
    is_preconverted_ov_model,
    start_stt_background,
    wait_for_model_ready,
)
from modules.util import (
    create_cache_directory,
    validate_and_sanitize_cache_dir,
    validate_and_sanitize_model_id,
)
from model_downloader.ovms import serve_lock_path
from worker_common import (
    async_shared_model_lock,
    base_parser,
    server_timing,
    timed,
    create_app,
    get_logger,
    install_models_routes,
    install_openai_errors,
    instance_data_dir,
    models_dir,
    serve,
    startup_timeout,
)

SERVICE_ID = "speech-to-text"
BACKEND = "ovms"
DEFAULT_PORT = 8023
DEFAULT_MODEL = "openai/whisper-base"
DEFAULT_DENOISE_MODEL = "noise-suppression-poconetlike-0001"
RESPONSE_FORMATS = ("json", "text", "verbose_json", "srt", "vtt")

WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
# Per-instance (WORKER_DIR/tmp standalone), so uploads never share a directory with a sibling.
TEMP_DIR = os.path.join(str(instance_data_dir(WORKER_DIR)), "tmp")

logger = get_logger(SERVICE_ID)

CONFIG: dict[str, Any] = {
    "port": DEFAULT_PORT,
    "stt_model_id": DEFAULT_MODEL,
    "stt_device": "CPU",
    "denoise_model_id": DEFAULT_DENOISE_MODEL,
    "denoise_device": "CPU",
    "source": "huggingface",
    "precision": "int8",
    # Set in main() (--ovms-port or --port + 1), never a fixed port two instances could share.
    "ovms_port": None,
}

STATE: dict[str, Any] = {"ready": False, "error": None, "startup_seconds": None}
OVMS_PROCESS = None
DENOISE_COMPILED_MODEL = None
DENOISE_LOCK = asyncio.Lock()
# Silero VAD for /v1/audio/stream; loaded at startup, retried on first use.
VAD_MODEL = None
VAD_LOCK = asyncio.Lock()

# One pooled OVMS connection for every request. Always 127.0.0.1: on Windows "localhost" tries ::1
# first and OVMS is IPv4-only, costing ~2 s of failover per connection.
OVMS_SESSION = http_requests.Session()
OVMS_TIMEOUT_S = 600


# Model directories

def _ovms_repository_dir(model_id: str, precision: str) -> str:
    """The OVMS repository: ``models/stt/ovms`` (fp32, pre-converted IR) or ``ovms-<precision>``.

    Re-pulling a model a repository holds only rewrites its graph, so each precision needs its own.
    """
    leaf = "ovms" if precision == "fp32" or is_preconverted_ov_model(model_id) else f"ovms-{precision}"
    path = validate_and_sanitize_cache_dir(str(models_dir("stt", leaf)))
    create_cache_directory(path)
    return path


def _omz_models_dir() -> str:
    path = validate_and_sanitize_cache_dir(str(models_dir("stt", "omz")))
    create_cache_directory(path)
    return path


def _initialize_denoise_model():
    """Fetch (once) and compile the OMZ noise-suppression model, falling back to the CPU.

    Some compilers reject it (Core Ultra X9 378H NPU: "DecomposeAttention Pass failed").
    """
    device = CONFIG["denoise_device"]
    try:
        return _compile_denoise_model(device)
    except Exception as exc:  # noqa: BLE001 - the plugin raises RuntimeError
        if device == "CPU":
            raise
        logger.warning("Denoise model failed to compile on %s, using the CPU instead: %s", device, exc)
        CONFIG["denoise_device"] = "CPU"
        return _compile_denoise_model("CPU")


def _compile_denoise_model(device: str):
    model_id = validate_and_sanitize_model_id(CONFIG["denoise_model_id"])
    precision = "FP32" if device == "CPU" else "FP16"
    root = _omz_models_dir()
    model_xml = os.path.join(root, model_id, precision, f"{model_id}.xml")
    if not os.path.exists(model_xml):
        logger.info("Denoise model not found. Downloading ...")
        model_xml = download_omz_model(root, model_id, precision)
    return load_denoise_model(model_xml, device=device)


# Lifespan

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global OVMS_PROCESS

    started = time.monotonic()
    os.makedirs(TEMP_DIR, exist_ok=True)
    model_id = validate_and_sanitize_model_id(CONFIG["stt_model_id"])
    repository = _ovms_repository_dir(model_id, CONFIG["precision"])

    logger.info(
        "Starting OVMS speech2text for %s on %s (precision %s, OVMS port %s) ...",
        model_id,
        CONFIG["stt_device"],
        CONFIG["precision"],
        CONFIG["ovms_port"],
    )
    try:
        # The pull writes the graph for this device and OVMS reads it on load, so the same model on
        # another device waits here (see serve_lock_path).
        async with async_shared_model_lock(serve_lock_path(repository, model_id)):
            OVMS_PROCESS = await asyncio.to_thread(
                start_stt_background,
                model_id,
                repository,
                CONFIG["precision"],
                CONFIG["ovms_port"],
                CONFIG["source"],
                CONFIG["stt_device"],
            )
            timeout = startup_timeout()
            ready = await asyncio.to_thread(
                wait_for_model_ready, CONFIG["ovms_port"], model_id, timeout
            )
        if not ready:
            raise RuntimeError(
                f"OVMS server did not become ready within {timeout}s or exited "
                f"early (device: {CONFIG['stt_device']}); see the worker logs"
            )
    except Exception as exc:
        STATE["error"] = f"{type(exc).__name__}: {exc}"
        logger.error("Failed to initialize the OVMS speech-to-text backend: %s", exc)
        cleanup_ovms_process()
        raise

    # The VAD only serves live streaming: a failure here is logged and retried
    # when a stream connects, never a reason to refuse batch transcription.
    try:
        await _ensure_vad_model()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Silero VAD not loaded (live streaming unavailable for now): %s", exc)

    STATE["ready"] = True
    STATE["startup_seconds"] = round(time.monotonic() - started, 2)
    logger.info("OVMS speech-to-text ready in %ss", STATE["startup_seconds"])

    yield

    STATE["ready"] = False
    logger.info("Stopping OVMS speech-to-text backend ...")
    cleanup_ovms_process()
    OVMS_SESSION.close()


app = create_app("speech-to-text (OVMS)", lifespan=lifespan, healthcheck=False)


# Contract routes

@app.get("/healthcheck", include_in_schema=False)
def get_healthcheck() -> JSONResponse:
    """Same shape as the OEP wrapper's: 503 until OVMS reports the model ready."""
    ready = bool(STATE["ready"])
    body: dict[str, Any] = {
        "status": "ok" if ready else "starting",
        "service": SERVICE_ID,
        "backend": BACKEND,
        "upstream": "openvino-model-server",
        "active_model": CONFIG["stt_model_id"],
        "device": CONFIG["stt_device"],
        "port": CONFIG["port"],
        "model_loaded": ready,
    }
    if STATE["startup_seconds"] is not None:
        body["startup_seconds"] = STATE["startup_seconds"]
    if STATE["error"]:
        body["status"] = "error"
        body["error"] = STATE["error"]
    return JSONResponse(body, status_code=200 if ready else 503)


@app.get("/v1/model-info")
def get_model_info() -> dict[str, Any]:
    model = CONFIG["stt_model_id"]
    return {
        "model": model,
        "provider": BACKEND,
        "device": CONFIG["stt_device"],
        "weight_format": None if is_preconverted_ov_model(model) else CONFIG["precision"],
        "denoise_model": CONFIG["denoise_model_id"],
        "capabilities": {
            "streaming": False,
            "realtime": False,
            "audio_stream": True,
            "denoise": True,
            "translation": _translates(model),
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


def _is_auto_language(language: Optional[str]) -> bool:
    """``language=auto``: the model detects the language. OVMS does not say
    which one, so answers that name the language say ``null``."""
    return (language or "").strip().lower() == "auto"


def _language_form(language: Optional[str]) -> list[tuple[str, str]]:
    """The ``language`` field for OVMS: left out for ``auto`` (OVMS then
    detects it), English when none was given."""
    if _is_auto_language(language):
        return []
    return [("language", language or "en")]


def _transcribe_utterance(pcm: np.ndarray, language: str) -> str:
    """Transcribe one live utterance through OVMS (blocking).

    The stream is already 16 kHz mono int16, so the WAV is built in memory with no ffmpeg pass.
    """
    form_data = [("model", CONFIG["stt_model_id"]), *_language_form(language)]
    files = [("file", ("utterance.wav", pcm_to_wav_bytes(pcm), "audio/wav"))]
    resp = _post_to_ovms(_ovms_audio_url("transcriptions"), form_data, files)
    if not resp.ok:
        raise RuntimeError(f"OVMS transcriptions failed ({resp.status_code}): {resp.text}")
    return (resp.json().get("text") or "").strip()


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

def _parse_bool(value: Optional[str]) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


# For these, OVMS translations return the source-language transcript: large-v3-turbo was tuned on
# transcription only, and Qwen3-ASR has no translate task.
_TRANSCRIBE_ONLY_MODELS = ("whisper-large-v3-turbo", "qwen3-asr")


def _translates(model_id: str) -> bool:
    name = model_id.lower()
    return not any(marker in name for marker in _TRANSCRIBE_ONLY_MODELS)


@app.post("/v1/audio/transcriptions", tags=["OpenAI-compatible"])
async def transcription(
    response: Response,
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),  # OpenAI compatibility; the configured model is used
    language: Optional[str] = Form("en"),
    response_format: Optional[str] = Form("json"),
    prompt: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
    timestamp_granularities: Optional[list[str]] = Form(None, alias="timestamp_granularities[]"),
    stream: Optional[str] = Form(None),
    use_denoise: Optional[str] = Form(None),
    return_timestamps: Optional[str] = Form(None),
):
    del model
    fmt = (response_format or "json").strip().lower()
    if fmt not in RESPONSE_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"response_format must be one of {', '.join(RESPONSE_FORMATS)}",
        )
    if _parse_bool(stream):
        raise HTTPException(
            status_code=400,
            detail="Streaming is not available on the OVMS backend; switch the "
            "Speech to Text service to the OEP backend for stream=true.",
        )
    if temperature is not None and not 0.0 <= temperature <= 1.0:
        raise HTTPException(
            status_code=400, detail="temperature must be between 0 and 1"
        )
    granularities = _granularities(timestamp_granularities)
    # `timestamp_granularities[]` is only meaningful alongside verbose_json,
    # which is the rule OpenAI enforces too.
    if granularities and fmt != "verbose_json":
        raise HTTPException(
            status_code=400,
            detail="timestamp_granularities[] requires response_format=verbose_json",
        )
    want_segments = (
        fmt in ("verbose_json", "srt", "vtt")
        or "segment" in granularities
        or _parse_bool(return_timestamps)
    )

    input_file_path = None
    wav_path = None
    try:
        input_file_path = await _save_upload(file)
        # soundfile/pydub/ffmpeg decode the whole upload: off the event loop.
        wav_path = await asyncio.to_thread(_convert_to_wav, input_file_path)

        if _parse_bool(use_denoise):
            await _apply_denoise(wav_path)

        form_data = [("model", CONFIG["stt_model_id"]), *_language_form(language)]
        # OVMS's own endpoint is OpenAI-shaped, so these forward unchanged.
        if prompt:
            form_data.append(("prompt", prompt))
        if temperature is not None:
            form_data.append(("temperature", str(temperature)))
        for granularity in granularities or (["segment"] if want_segments else []):
            form_data.append(("timestamp_granularities[]", granularity))

        ovms_data = await _post_audio_to_ovms("transcriptions", wav_path, form_data, response)
        text = (ovms_data.get("text") or "").strip()
        duration = await asyncio.to_thread(_wav_duration, wav_path)
        segments = (
            _segments_or_whole(ovms_data.get("segments"), text, duration) if want_segments else []
        )

        if fmt == "text":
            return PlainTextResponse(text)
        if fmt == "srt":
            return PlainTextResponse(_to_srt(segments, text), media_type="text/plain; charset=utf-8")
        if fmt == "vtt":
            return PlainTextResponse(_to_vtt(segments, text), media_type="text/vtt; charset=utf-8")

        # `status` isn't OpenAI's, but the demo reads it. `duration` (OpenAI's verbose_json field) is on
        # every JSON answer for the app's Live metrics.
        body: dict[str, Any] = {
            "text": text,
            "status": True,
            "duration": duration,
        }
        if fmt == "verbose_json":
            body = {
                "task": "transcribe",
                "language": None if _is_auto_language(language) else language or "en",
                "duration": duration,
                "text": text,
                "status": True,
            }
            # OpenAI includes `segments` and `words` only for the granularity
            # that was asked for, defaulting to segment.
            if not granularities or "segment" in granularities:
                body["segments"] = segments
            if "word" in granularities:
                body["words"] = _normalize_words(ovms_data.get("words") or [])
        elif want_segments:
            body["segments"] = segments
        return body

    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001 - surfaced as 500 with the reason
        logger.error("Error in STT transcription: %s", error)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe the voice input. Error: {error}",
        )
    finally:
        await asyncio.to_thread(_cleanup_temp_files, input_file_path, wav_path)


@app.post("/v1/audio/translations", tags=["OpenAI-compatible"])
async def translation(
    response: Response,
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    response_format: Optional[str] = Form("json"),
    prompt: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
):
    del model
    fmt = (response_format or "json").strip().lower()
    if fmt not in RESPONSE_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"response_format must be one of {', '.join(RESPONSE_FORMATS)}",
        )
    if temperature is not None and not 0.0 <= temperature <= 1.0:
        raise HTTPException(
            status_code=400, detail="temperature must be between 0 and 1"
        )
    if not _translates(CONFIG["stt_model_id"]):
        raise HTTPException(
            status_code=400,
            detail=f"{CONFIG['stt_model_id']} only transcribes: it would answer with the "
            "original-language text. Switch the Speech to Text service to Whisper Large v3, "
            "Medium, Small, Base or Tiny to translate to English.",
        )
    want_segments = fmt in ("verbose_json", "srt", "vtt")

    input_file_path = None
    wav_path = None
    try:
        input_file_path = await _save_upload(file)
        wav_path = await asyncio.to_thread(_convert_to_wav, input_file_path)
        form_data = [("model", CONFIG["stt_model_id"])]
        if prompt:
            form_data.append(("prompt", prompt))
        if temperature is not None:
            form_data.append(("temperature", str(temperature)))
        if want_segments:
            form_data.append(("timestamp_granularities[]", "segment"))

        ovms_data = await _post_audio_to_ovms("translations", wav_path, form_data, response)
        text = (ovms_data.get("text") or "").strip()
        duration = await asyncio.to_thread(_wav_duration, wav_path)
        segments = (
            _segments_or_whole(ovms_data.get("segments"), text, duration) if want_segments else []
        )

        if fmt == "text":
            return PlainTextResponse(text)
        if fmt == "srt":
            return PlainTextResponse(_to_srt(segments, text), media_type="text/plain; charset=utf-8")
        if fmt == "vtt":
            return PlainTextResponse(_to_vtt(segments, text), media_type="text/vtt; charset=utf-8")
        if fmt == "verbose_json":
            return {
                "task": "translate",
                # Whisper's translation target is always English.
                "language": "english",
                "duration": duration,
                "text": text,
                "status": True,
                "segments": segments,
            }
        return {"text": text, "status": True, "duration": duration}
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001
        logger.error("Error in STT translation: %s", error)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to translate the voice input. Error: {error}",
        )
    finally:
        await asyncio.to_thread(_cleanup_temp_files, input_file_path, wav_path)


# Helpers

async def _apply_denoise(wav_path: str) -> None:
    global DENOISE_COMPILED_MODEL
    async with DENOISE_LOCK:
        if DENOISE_COMPILED_MODEL is None:
            logger.info("Loading denoise model for the first time ...")
            DENOISE_COMPILED_MODEL = await asyncio.to_thread(_initialize_denoise_model)
    logger.info("Denoising audio ...")
    denoised = await asyncio.to_thread(denoise, DENOISE_COMPILED_MODEL, wav_path)
    await asyncio.to_thread(_write_bytes, wav_path, denoised)


def _write_bytes(path: str, data: bytes) -> None:
    """Blocking file write -- run via asyncio.to_thread."""
    with open(path, "wb") as fh:
        fh.write(data)


async def _save_upload(file: UploadFile) -> str:
    """Persist an upload under TEMP_DIR with a request-unique name."""
    ext = ".webm"
    if file.filename:
        _base, file_ext = os.path.splitext(os.path.basename(file.filename))
        if file_ext:
            ext = file_ext
    path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}{ext}")
    await asyncio.to_thread(_write_bytes, path, await file.read())
    return path


def _convert_to_wav(input_file_path: str) -> str:
    """Convert a saved upload to 16 kHz mono WAV next to it (blocking; run in a thread)."""
    stem = os.path.splitext(os.path.basename(input_file_path))[0]
    wav_path = os.path.join(TEMP_DIR, f"{stem}.wav")
    if not ensure_wav(input_file_path, wav_path):
        raise RuntimeError(
            "Failed to convert uploaded audio to WAV. Please check if ffmpeg is installed."
        )
    return wav_path


def _ovms_audio_url(endpoint: str) -> str:
    # 127.0.0.1, never "localhost" -- see OVMS_SESSION.
    return f"http://127.0.0.1:{CONFIG['ovms_port']}/v3/audio/{endpoint}"


def _post_to_ovms(url: str, data: list, files: list):
    """Blocking POST to OVMS over the shared session -- run via asyncio.to_thread."""
    return OVMS_SESSION.post(url, data=data, files=files, timeout=OVMS_TIMEOUT_S)


def _post_wav_to_ovms(url: str, wav_path: str, data: list):
    """Blocking upload of a WAV file to OVMS -- run via asyncio.to_thread."""
    with open(wav_path, "rb") as audio_f:
        files = [("file", (os.path.basename(wav_path), audio_f, "audio/wav"))]
        return _post_to_ovms(url, data, files)


async def _post_audio_to_ovms(
    endpoint: str, wav_path: str, form_data: list, response: Optional[Response] = None
) -> dict:
    url = _ovms_audio_url(endpoint)
    with timed() as clock:
        resp = await asyncio.to_thread(_post_wav_to_ovms, url, wav_path, form_data)
    if not resp.ok:
        raise RuntimeError(f"OVMS {endpoint} failed ({resp.status_code}): {resp.text}")
    # Model time only (the OVMS call, not the conversion), for the app's Live metrics.
    if response is not None:
        response.headers.update(server_timing(clock.seconds))
    return resp.json()


def _granularities(raw: Optional[list[str]]) -> list[str]:
    """Validated ``timestamp_granularities[]``; a comma-separated single value is split too."""
    if not raw:
        return []
    out: list[str] = []
    for entry in raw:
        for value in str(entry).split(","):
            value = value.strip().lower()
            if not value:
                continue
            if value not in ("segment", "word"):
                raise HTTPException(
                    status_code=400,
                    detail="timestamp_granularities[] must be 'segment' or 'word'",
                )
            if value not in out:
                out.append(value)
    return out


def _normalize_words(raw: list) -> list[dict[str, Any]]:
    """OVMS word timings in OpenAI's ``verbose_json`` word shape."""
    words = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        words.append(
            {
                "word": str(item.get("word") or "").strip(),
                "start": float(item.get("start") or 0.0),
                "end": float(item.get("end") or 0.0),
            }
        )
    return words


def _normalize_segments(raw: list) -> list[dict[str, Any]]:
    """OVMS segments in OpenAI's ``verbose_json`` shape.

    openai-python fails to parse a segment missing any typed field, so absent ones get neutral defaults.
    """
    segments = []
    for index, seg in enumerate(raw):
        if not isinstance(seg, dict):
            continue
        start = float(seg.get("start") or 0.0)
        tokens = seg.get("tokens")
        segments.append(
            {
                "id": seg.get("id", index),
                # Whisper's decoder offset, in frames of 10 ms. OVMS omits it;
                # deriving it from `start` keeps it consistent with the timings.
                "seek": int(seg.get("seek", int(start * 100))),
                "start": start,
                "end": float(seg.get("end") or 0.0),
                "text": str(seg.get("text") or "").strip(),
                "tokens": list(tokens) if isinstance(tokens, (list, tuple)) else [],
                "temperature": float(seg.get("temperature") or 0.0),
                "avg_logprob": float(seg.get("avg_logprob") or 0.0),
                "compression_ratio": float(seg.get("compression_ratio") or 0.0),
                "no_speech_prob": float(seg.get("no_speech_prob") or 0.0),
            }
        )
    return segments


def _segments_or_whole(raw: Any, text: str, duration: float) -> list[dict[str, Any]]:
    """OVMS segments in OpenAI's shape, or one segment spanning the audio.

    Qwen3-ASR gives no timestamps, but verbose_json always carries segments and srt/vtt need cues.
    """
    segments = _normalize_segments(raw or [])
    if segments or not text:
        return segments
    return _normalize_segments([{"start": 0.0, "end": duration, "text": text}])


def _wav_duration(wav_path: str) -> float:
    try:
        with wave.open(wav_path, "rb") as wav:
            return round(wav.getnframes() / float(wav.getframerate() or 1), 3)
    except Exception:  # noqa: BLE001
        return 0.0


def _timestamp(seconds: float, separator: str) -> str:
    total_ms = int(round(max(seconds, 0.0) * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _cues(segments: list[dict[str, Any]], text: str) -> list[dict[str, Any]]:
    if segments:
        return [s for s in segments if s["text"]]
    return [{"start": 0.0, "end": 0.0, "text": text}] if text else []


def _to_srt(segments: list[dict[str, Any]], text: str) -> str:
    lines = []
    for index, cue in enumerate(_cues(segments, text), start=1):
        lines.append(str(index))
        lines.append(f"{_timestamp(cue['start'], ',')} --> {_timestamp(cue['end'], ',')}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)


def _to_vtt(segments: list[dict[str, Any]], text: str) -> str:
    lines = ["WEBVTT", ""]
    for cue in _cues(segments, text):
        lines.append(f"{_timestamp(cue['start'], '.')} --> {_timestamp(cue['end'], '.')}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)


def _cleanup_temp_files(*paths: Optional[str]) -> None:
    for path in paths:
        if not path:
            continue
        for candidate in (path, path + ".orig"):
            if os.path.exists(candidate):
                try:
                    os.remove(candidate)
                except OSError:
                    pass


# OpenAI compatibility

def _served_models() -> list[str]:
    """``GET /v1/models``: the configured model plus ``whisper-1`` (OpenAI clients' default id).

    The audio routes ignore ``model``, so either answers the same.
    """
    served = [CONFIG["stt_model_id"]]
    if "whisper-1" not in served:
        served.append("whisper-1")
    return served


install_models_routes(app, _served_models, owned_by="openvino-model-server")
install_openai_errors(app)


# Entrypoint

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    # --device is declared here rather than by base_parser so it keeps the
    # --stt-device alias older buildArgs send.
    parser = base_parser(
        "Speech-to-Text Worker (OpenVINO Model Server)",
        default_port=DEFAULT_PORT,
        device=False,
        source=True,
    )
    parser.add_argument(
        "--model",
        "--stt-model-id",
        dest="model",
        default=DEFAULT_MODEL,
        help="Hugging Face / ModelScope model id (openai/whisper-*, or a pre-converted OpenVINO/*-ov repo)",
    )
    parser.add_argument(
        "--device",
        "--stt-device",
        dest="device",
        default="AUTO",
        help=(
            "Device for the Whisper model: AUTO (OpenVINO selects: a discrete GPU, "
            "then an integrated GPU, then the CPU), CPU, GPU, NPU"
        ),
    )
    parser.add_argument("--denoise-model-id", default=DEFAULT_DENOISE_MODEL, help="OMZ denoise model id")
    parser.add_argument("--denoise-device", default=None, help="Device for the denoise model (default: --device)")
    parser.add_argument(
        "--precision",
        default="int8",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Weight format when OVMS converts a non-OpenVINO model (default: int8)",
    )
    parser.add_argument(
        "--ovms-port",
        type=int,
        default=None,
        help="Port for the embedded OVMS (default: --port + 1, so two instances never collide)",
    )
    # parse_known_args so an unrecognised flag from buildArgs degrades to a
    # warning rather than killing the worker.
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        logger.warning("ignoring unrecognised arguments: %s", " ".join(unknown))
    return args


def main() -> None:
    args = parse_args()
    CONFIG["port"] = args.port
    CONFIG["stt_model_id"] = args.model
    CONFIG["stt_device"] = str(args.device).upper()
    CONFIG["denoise_model_id"] = args.denoise_model_id
    CONFIG["denoise_device"] = str(args.denoise_device or args.device).upper()
    CONFIG["source"] = args.source
    CONFIG["precision"] = args.precision
    CONFIG["ovms_port"] = args.ovms_port or (args.port + 1)
    serve(app, args, log_level="info")


if __name__ == "__main__":
    main()
