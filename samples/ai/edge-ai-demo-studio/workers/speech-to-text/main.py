# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import uuid
import argparse
import logging
import multiprocessing
import asyncio
from typing import Optional
from contextlib import asynccontextmanager

import requests as http_requests
import uvicorn
from fastapi import FastAPI, UploadFile, Form, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from modules.stt_ovms import (
    start_stt_background,
    wait_for_model_ready,
    cleanup_ovms_process,
)
from modules.util import (
    create_cache_directory,
    validate_and_sanitize_cache_dir,
    validate_and_sanitize_model_id,
)
from modules.audio import ensure_wav
from modules.denoise import (
    denoise,
    download_omz_model,
    load_denoise_model,
)

logger = logging.getLogger("uvicorn.error")

OVMS_PROCESS = None
DENOISE_COMPILED_MODEL = None
TEMP_DIR = None

CONFIG = {
    "stt_device": "CPU",
    "stt_model_id": "openai/whisper-base",
    "denoise_device": "CPU",
    "denoise_model_id": "noise-suppression-poconetlike-0001",
    "source": "huggingface",
    "precision": "fp32",
    "ovms_port": 5009,
    "port": 8023,
}


def _get_model_directories():
    """Resolve and validate the model cache directories."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    model_dir = os.path.join(project_root, "models")
    stt_model_cache_dir = os.path.join(model_dir, "stt")
    intel_model_cache_dir = os.path.join(stt_model_cache_dir, "intel")

    stt_model_cache_dir = validate_and_sanitize_cache_dir(stt_model_cache_dir)
    intel_model_cache_dir = validate_and_sanitize_cache_dir(intel_model_cache_dir)
    create_cache_directory(stt_model_cache_dir)

    return stt_model_cache_dir, intel_model_cache_dir


def _initialize_denoise_model():
    """Load the OMZ noise-suppression model (lazy)."""
    global CONFIG
    denoise_model = CONFIG["denoise_model_id"]
    validated_denoise_model = validate_and_sanitize_model_id(denoise_model)

    stt_model_cache_dir, intel_model_cache_dir = _get_model_directories()
    denoise_model_precision = "FP32" if CONFIG["denoise_device"] == "CPU" else "FP16"
    denoise_model_xml = os.path.join(
        intel_model_cache_dir,
        validated_denoise_model,
        denoise_model_precision,
        f"{validated_denoise_model}.xml",
    )

    if not os.path.exists(denoise_model_xml):
        logger.info("Denoise model not found. Downloading ...")
        download_omz_model(stt_model_cache_dir, validated_denoise_model, denoise_model_precision)

    compiled = load_denoise_model(denoise_model_xml, device=CONFIG["denoise_device"])
    return compiled


@asynccontextmanager
async def lifespan(app: FastAPI):
    global OVMS_PROCESS, DENOISE_COMPILED_MODEL, TEMP_DIR

    logger.info("Initializing STT server services ...")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    TEMP_DIR = os.path.join(script_dir, "tmp")
    os.makedirs(TEMP_DIR, exist_ok=True)

    validated_model_id = validate_and_sanitize_model_id(CONFIG["stt_model_id"])
    stt_model_cache_dir, _ = _get_model_directories()

    try:
        logger.info("Starting OVMS speech2text server ...")
        OVMS_PROCESS = await asyncio.to_thread(
            start_stt_background,
            validated_model_id,
            validated_model_id,
            stt_model_cache_dir,
            CONFIG["precision"],
            CONFIG["ovms_port"],
            CONFIG["source"],
            CONFIG["stt_device"],
            True,
        )

        if OVMS_PROCESS and hasattr(OVMS_PROCESS, "pid"):
            logger.info(f"OVMS server started with PID: {OVMS_PROCESS.pid}")

        logger.info("Waiting for OVMS server to be ready ...")
        model_ready = await asyncio.to_thread(
            wait_for_model_ready,
            CONFIG["ovms_port"],
            validated_model_id,
            180,
        )
        if not model_ready:
            raise RuntimeError("OVMS server failed to become ready within timeout")

        logger.info("STT server services initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize STT server services: {e}")
        if OVMS_PROCESS:
            OVMS_PROCESS.terminate()
            OVMS_PROCESS.wait()
        raise e

    yield

    logger.info("Stopping STT server services ...")
    if OVMS_PROCESS:
        logger.info("Terminating OVMS process ...")
        cleanup_ovms_process()


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck", status_code=200)
def get_healthcheck():
    return "OK"


@app.post("/v1/audio/transcriptions")
async def transcription(
    file: UploadFile = File(...),
    language: Optional[str] = Form("en"),
    use_denoise: Optional[bool] = Form(False),
    return_timestamps: Optional[bool] = Form(False),
):
    global DENOISE_COMPILED_MODEL

    input_file_path = None
    file_path = None

    try:
        input_file_path = await _save_upload(file)
        file_path = _convert_to_wav(input_file_path)

        if use_denoise:
            if DENOISE_COMPILED_MODEL is None:
                logger.info("Loading denoise model for the first time ...")
                DENOISE_COMPILED_MODEL = _initialize_denoise_model()
            logger.info("Denoising audio ...")
            denoised_bytes = denoise(DENOISE_COMPILED_MODEL, file_path)
            with open(file_path, "wb") as f:
                f.write(denoised_bytes)

        form_data = [
            ("model", CONFIG["stt_model_id"]),
            ("language", language if language is not None else "en"),
        ]
        if return_timestamps:
            form_data.append(("timestamp_granularities[]", "segment"))

        ovms_data = await _post_audio_to_ovms("transcriptions", file_path, form_data)
        text = ovms_data.get("text", "")

        if return_timestamps:
            return {"text": text, "status": True, "segments": ovms_data.get("segments", [])}
        return {"text": text, "status": True}

    except Exception as error:
        logger.error(f"Error in STT transcription: {error}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe the voice input. Error: {error}",
        )
    finally:
        _cleanup_temp_files(input_file_path, file_path)


@app.post("/v1/audio/translations")
async def translation(
    file: UploadFile = File(...),
):
    input_file_path = None
    file_path = None

    try:
        input_file_path = await _save_upload(file)
        file_path = _convert_to_wav(input_file_path)

        form_data = [("model", CONFIG["stt_model_id"])]
        ovms_data = await _post_audio_to_ovms("translations", file_path, form_data)
        return {"text": ovms_data.get("text", ""), "status": True}

    except Exception as error:
        logger.error(f"Error in STT translation: {error}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to translate the voice input. Error: {error}",
        )
    finally:
        _cleanup_temp_files(input_file_path, file_path)


def _post_to_ovms(url: str, data: list, files: list):
    """Blocking POST to OVMS — run via asyncio.to_thread."""
    return http_requests.post(url, data=data, files=files, timeout=300)


async def _save_upload(file: UploadFile) -> str:
    """Persist an uploaded audio file to TEMP_DIR and return its path."""
    if file.filename:
        safe_name = os.path.basename(file.filename)
        base_name, ext = os.path.splitext(safe_name)
        if not base_name:
            base_name = str(uuid.uuid4())
        input_file_path = os.path.join(TEMP_DIR, f"{base_name}{ext or '.webm'}")
    else:
        input_file_path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}.webm")
    with open(input_file_path, "wb") as f:
        f.write(await file.read())
    return input_file_path


def _convert_to_wav(input_file_path: str) -> str:
    """Convert a saved upload to WAV and return the wav path."""
    file_name = os.path.splitext(os.path.basename(input_file_path))[0]
    file_path = os.path.join(TEMP_DIR, f"{file_name}.wav")
    if not ensure_wav(input_file_path, file_path):
        raise RuntimeError(
            "Failed to convert uploaded audio to WAV. Please check if ffmpeg is installed."
        )
    return file_path


async def _post_audio_to_ovms(endpoint: str, file_path: str, form_data: list) -> dict:
    """POST a WAV file to an OVMS audio endpoint and return the parsed JSON."""
    url = f"http://localhost:{CONFIG['ovms_port']}/v3/audio/{endpoint}"
    with open(file_path, "rb") as audio_f:
        files = [("file", (os.path.basename(file_path), audio_f, "audio/wav"))]
        ovms_resp = await asyncio.to_thread(_post_to_ovms, url, form_data, files)
    if not ovms_resp.ok:
        raise RuntimeError(
            f"OVMS {endpoint} failed ({ovms_resp.status_code}): {ovms_resp.text}"
        )
    return ovms_resp.json()


def _cleanup_temp_files(input_file_path: Optional[str], file_path: Optional[str]) -> None:
    """Remove request-scoped temp files and any '.orig' sidecar left by conversion."""
    for path in (input_file_path, file_path):
        if path and os.path.exists(path):
            os.remove(path)
    if input_file_path:
        orig_path = input_file_path + ".orig"
        if os.path.exists(orig_path):
            os.remove(orig_path)


def parse_args():
    parser = argparse.ArgumentParser(description="Speech-to-Text Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=8023,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--stt-model-id",
        type=str,
        required=True,
        help="HuggingFace or ModelScope model ID (e.g. openai/whisper-tiny)",
    )
    parser.add_argument(
        "--stt-device",
        type=str,
        default="CPU",
        help="Device for the STT model (CPU, GPU, NPU)",
    )
    parser.add_argument(
        "--denoise-model-id",
        type=str,
        default="noise-suppression-poconetlike-0001",
        help="OMZ denoise model ID",
    )
    parser.add_argument(
        "--denoise-device",
        type=str,
        default="CPU",
        help="Device for the denoise model (CPU, GPU, NPU)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model download source",
    )
    parser.add_argument(
        "--precision",
        type=str,
        default="fp32",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Weight format for model export (default: fp32)",
    )
    parser.add_argument(
        "--ovms-port",
        type=int,
        default=5009,
        help="Internal port for the OVMS subprocess (default: 5009)",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["port"] = args.port
    CONFIG["stt_model_id"] = args.stt_model_id
    CONFIG["stt_device"] = str(args.stt_device).upper()
    CONFIG["denoise_model_id"] = args.denoise_model_id
    CONFIG["denoise_device"] = str(args.denoise_device).upper()
    CONFIG["source"] = args.source
    CONFIG["precision"] = args.precision
    CONFIG["ovms_port"] = args.ovms_port

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
