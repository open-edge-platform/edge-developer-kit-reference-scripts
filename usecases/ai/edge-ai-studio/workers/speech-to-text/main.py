# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import uuid
import time
import argparse
import logging
from typing import Optional
import multiprocessing
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, UploadFile, Form, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, UploadFile
from fastapi.exceptions import HTTPException

from utils import (
    create_cache_directory,
    denoise,
    download_model,
    download_and_export_model,
    download_omz_model,
    ensure_wav,
    load_denoise_model,
    load_model_pipeline,
    transcribe,
    translate,
    validate_and_sanitize_cache_dir,
    validate_and_sanitize_model_id,
)

logger = logging.getLogger("uvicorn.error")

STT_PIPELINE = None
DENOISE_COMPILED_MODEL = None
TEMP_DIR = None

CONFIG = {
    "stt_device": "CPU",
    "stt_model_id": "openai/whisper-tiny",
    "denoise_device": "CPU",
    "denoise_model_id": "noise-suppression-poconetlike-0001",
}


def clean_up():
    logger.info("Shutting down server ...")


def get_model_directories():
    """Get and validate model directories."""
    # Set project root as two levels above this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))

    # Set cache directories inside project root
    model_dir = os.path.join(project_root, "models")
    hf_model_cache_dir = os.path.join(model_dir, "huggingface")
    ov_model_cache_dir = os.path.join(model_dir, "ovms")
    intel_model_cache_dir = os.path.join(model_dir, "intel")

    # Validate and sanitize the cache directories
    hf_model_cache_dir = validate_and_sanitize_cache_dir(hf_model_cache_dir)
    ov_model_cache_dir = validate_and_sanitize_cache_dir(ov_model_cache_dir)
    intel_model_cache_dir = validate_and_sanitize_cache_dir(intel_model_cache_dir)

    # Create the directories if they don't exist
    create_cache_directory(hf_model_cache_dir)
    create_cache_directory(ov_model_cache_dir)

    return model_dir, hf_model_cache_dir, ov_model_cache_dir, intel_model_cache_dir


def initialize_stt_model():
    """Initialize STT model only."""
    global CONFIG, STT_PIPELINE
    stt_model_id = CONFIG["stt_model_id"]
    stt_model_provider = stt_model_id.split("/")[0] if "/" in stt_model_id else "local"

    model_dir, hf_model_cache_dir, ov_model_cache_dir, intel_model_cache_dir = (
        get_model_directories()
    )
    validated_stt_model_id = validate_and_sanitize_model_id(stt_model_id)

    try:
        if stt_model_provider == "OpenVINO":
            stt_model_dir = os.path.join(ov_model_cache_dir, validated_stt_model_id)
            if not os.path.exists(stt_model_dir):
                logger.info("OpenVINO model not found. Downloading model ...")
                download_model(validated_stt_model_id, stt_model_dir)
            else:
                logger.info(f"OpenVINO model already exists at: {stt_model_dir}")
        else:
            stt_model_dir = os.path.join(hf_model_cache_dir, validated_stt_model_id)
            if not os.path.exists(stt_model_dir):
                logger.info("Model not found. Downloading model ...")
                download_and_export_model(validated_stt_model_id, stt_model_dir)
            else:
                logger.info(f"Model already exists at: {stt_model_dir}")
    except Exception as e:
        print(f"Error downloading model {validated_stt_model_id}: {e}")
        raise RuntimeError(f"Failed to download model {validated_stt_model_id}")

    stt_pipeline = load_model_pipeline(stt_model_dir, device=CONFIG["stt_device"])
    return stt_pipeline


def initialize_denoise_model():
    """Initialize denoise model only (lazy loading)."""
    global CONFIG
    denoise_model = CONFIG["denoise_model_id"]
    validated_denoise_model = validate_and_sanitize_model_id(denoise_model)

    model_dir, hf_model_cache_dir, ov_model_cache_dir, intel_model_cache_dir = (
        get_model_directories()
    )

    denoise_model_precision = "FP32" if CONFIG["denoise_device"] == "CPU" else "FP16"
    denoise_model_xml = os.path.join(
        intel_model_cache_dir,
        validated_denoise_model,
        denoise_model_precision,
        f"{validated_denoise_model}.xml",
    )

    if not os.path.exists(denoise_model_xml):
        logger.info("Denoise model not found. Downloading default model ...")
        download_omz_model(model_dir, validated_denoise_model, denoise_model_precision)

    denoise_compiled_model = load_denoise_model(
        denoise_model_xml,
        device=CONFIG["denoise_device"],
    )
    return denoise_compiled_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing server services ...")
    global STT_PIPELINE, DENOISE_COMPILED_MODEL, TEMP_DIR

    script_dir = os.path.dirname(os.path.abspath(__file__))
    TEMP_DIR = os.path.join(script_dir, "tmp")
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR, exist_ok=True)

    # Only initialize STT model on startup
    STT_PIPELINE = initialize_stt_model()
    # Denoise model will be initialized lazily when needed
    DENOISE_COMPILED_MODEL = None

    yield
    clean_up()


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
):
    global STT_PIPELINE, DENOISE_COMPILED_MODEL
    try:
        # save uploaded file
        if file.filename:
            base_name, ext = os.path.splitext(file.filename)
            file_name = base_name
            input_file_path = os.path.join(TEMP_DIR, f"{file_name}{ext or '.webm'}")
        else:
            file_name = str(uuid.uuid4())
            input_file_path = os.path.join(TEMP_DIR, f"{file_name}.webm")

        with open(input_file_path, "wb") as f:
            f.write(file.file.read())

        file_path = os.path.join(TEMP_DIR, f"{file_name}.wav")

        # convert to wav robustly (pydub first, ffmpeg fallback)
        ok = ensure_wav(input_file_path, file_path)
        if not ok:
            raise RuntimeError(
                "Failed to convert uploaded audio to WAV. Please check if ffmpeg is installed."
            )

        if use_denoise:
            # Lazy load denoise model if not already loaded
            if DENOISE_COMPILED_MODEL is None:
                logger.info("Loading denoise model for the first time...")
                DENOISE_COMPILED_MODEL = initialize_denoise_model()

            logger.info("Denoising audio...")
            start_time = time.time()
            denoised_audio = denoise(DENOISE_COMPILED_MODEL, file_path)
            with open(file_path, "wb") as f:
                f.write(denoised_audio)

        if language is None:
            logger.warning("Language is not set. Default to english.")
            language = "english"

        start_time = time.time()
        text = transcribe(pipeline=STT_PIPELINE, audio=file_path, language=language)

    except Exception as error:
        logger.error(f"Error in STT transcriptions: {str(error)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe the voice input. Error: {error}",
        )
    finally:
        if os.path.exists(input_file_path):
            os.remove(input_file_path)
        if os.path.exists(file_path):
            os.remove(file_path)

    return {"text": text, "status": True}


@app.post("/v1/audio/translations")
async def translation(
    file: UploadFile = File(...), language: Optional[str] = Form("en")
):
    try:
        if file.filename:
            base_name, ext = os.path.splitext(file.filename)
            file_name = base_name
            input_file_path = os.path.join(TEMP_DIR, f"{file_name}{ext or '.webm'}")
        else:
            file_name = str(uuid.uuid4())
            input_file_path = os.path.join(TEMP_DIR, f"{file_name}.webm")

        with open(input_file_path, "wb") as f:
            f.write(file.file.read())

        file_path = os.path.join(TEMP_DIR, f"{file_name}.wav")

        ok = ensure_wav(input_file_path, file_path)
        if not ok:
            raise RuntimeError(
                "Failed to convert uploaded audio to WAV. Please check if ffmpeg is installed."
            )

        if language is None:
            logger.warning("Language is not set. Default to english.")
            language = "english"

        text = translate(
            pipeline=STT_PIPELINE, audio=file_path, source_language=language
        )

    except Exception as error:
        logger.error(f"Error in STT translations: {str(error)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to translate the voice input. Error: {error}",
        )

    return {"text": text, "status": True}


def parse_args():
    parser = argparse.ArgumentParser(description="Embedding Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=5005,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--stt-model-id",
        type=str,
        required=True,
        help="Path to the stt model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--stt-device",
        type=str,
        default="CPU",
        help="Device to run the stt model on (e.g., CPU, GPU, NPU)",
    )
    parser.add_argument(
        "--denoise-model-id",
        type=str,
        required=False,
        default="noise-suppression-poconetlike-0001",
        help="Name of Intel Open Model Zoo denoise models. Only noise-suppression-poconetlike-0001 or noise-suppression-denseunet-ll-0001 is supported.",
    )
    parser.add_argument(
        "--denoise-device",
        type=str,
        default="CPU",
        help="Device to run the denoise model on (e.g., CPU, GPU, NPU)",
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

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
