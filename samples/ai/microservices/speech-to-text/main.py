# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json
import time
import uuid
import logging
from typing import Optional
from pydub import AudioSegment

from fastapi import FastAPI, UploadFile, Form, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from contextlib import asynccontextmanager
import openvino as ov
from pydantic import BaseModel
from typing import Literal

from utils import (
    denoise,
    download_default_model,
    download_omz_model,
    load_denoise_model,
    load_model_pipeline,
    transcribe,
    translate
)
    
logger = logging.getLogger('uvicorn.error')
TEMP_AUDIO_DIR = "./tmp_audio"

STT_PIPELINE = None
STT_MODEL_IDS = ["openai/whisper-tiny", "openai/whisper-base", "openai/whisper-small", "openai/whisper-medium", "openai/whisper-large"]
STT_DEVICE = os.getenv("STT_DEVICE", "CPU")
STT_LANGUAGES = ["english", "malay", "chinese"]

DENOISE_COMPILED_MODEL = None
DENOISE_MODEL_IDS = ["noise-suppression-poconetlike-0001", "noise-suppression-denseunet-ll-0001"] 
DENOISE_MODEL_PRECISIONS = ["FP16", "FP32"]
DENOISE_DEVICE = os.getenv("DENOISE_DEVICE", "CPU")

DEVICES=[]
CONFIG={
    "language": STT_LANGUAGES[0],
    "stt_device": STT_DEVICE,
    "stt_model": os.getenv("DEFAULT_MODEL_ID", STT_MODEL_IDS[0]),
    "denoise_device": DENOISE_DEVICE,
    "denoise_model": os.getenv("DENOISE_MODEL_ID", DENOISE_MODEL_IDS[0]),
    "denoise_model_precision": os.getenv("DENOISE_MODEL_PRECISION", DENOISE_MODEL_PRECISIONS[0])
}

class Configurations(BaseModel):
    language: Literal[tuple(STT_LANGUAGES)]
    stt_device: str
    stt_model: Literal[tuple(STT_MODEL_IDS)]  
    denoise_device: str  
    denoise_model: Literal[tuple(DENOISE_MODEL_IDS)]
    denoise_model_precision: Literal[tuple(DENOISE_MODEL_PRECISIONS)]

def clean_up():
    logger.info("Shutting down server ...")
    
def initialize():
    # STT Model Setup
    global CONFIG
    model_name = CONFIG["stt_model"].split("/")[-1]
    model_dir = f"./data/models/{model_name}"

    if not os.path.exists(model_dir):
        logger.info("Model not found. Downloading default model ...")
        download_default_model(CONFIG["stt_model"], model_dir)

    stt_pipeline = load_model_pipeline(model_dir, device=CONFIG["stt_device"])

    # Denoise Model Setup
    denoise_model_dir = f"./data/models/intel/{CONFIG['denoise_model']}/{CONFIG['denoise_model_precision']}/{CONFIG['denoise_model']}.xml"

    if not os.path.exists(denoise_model_dir):
        logger.info("Denoise model not found. Downloading default model ...")
        download_omz_model(CONFIG["denoise_model"], 'data/models')

    denoise_compiled_model = load_denoise_model(
        denoise_model_dir, 
        device=CONFIG["denoise_device"], 
    )
    return stt_pipeline, denoise_compiled_model

def get_available_devices():
    devices = []
    core = ov.Core()
    available_devices = core.get_available_devices()
    for device_name in available_devices:
        full_device_name = core.get_property(device_name, "FULL_DEVICE_NAME")
        devices.append(
            {
                "name": full_device_name, 
                "value": device_name, 
            })
    return devices

@asynccontextmanager
async def lifespan(app: FastAPI):
    global STT_PIPELINE, DENOISE_COMPILED_MODEL, DEVICES
    logger.info("Starting server ...")
    if not os.path.exists(TEMP_AUDIO_DIR):
        os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)
        
    DEVICES =  get_available_devices()

    STT_PIPELINE, DENOISE_COMPILED_MODEL = initialize()
    
    yield
    clean_up()

allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["*"]'))
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/healthcheck', status_code=200)
def get_healthcheck():
    return 'OK'

@app.get("/v1/config")
async def get_config():
    global DEVICES, CONFIG
    DEVICES = get_available_devices()
    configs = {
        "language": STT_LANGUAGES, 
        "devices": DEVICES,
        "stt_models": STT_MODEL_IDS,
        "denoise_models": DENOISE_MODEL_IDS,
        "denoise_model_precisions": DENOISE_MODEL_PRECISIONS,
        "selected_config": CONFIG
    }
    
    return JSONResponse(content=jsonable_encoder(configs))

@app.post("/v1/update_config")
async def update_config(data: Configurations):
    global STT_PIPELINE, DENOISE_COMPILED_MODEL, CONFIG
    try:
        stt_device = data.stt_device
        denoise_device = data.denoise_device
        valid_stt_device = any(device["value"] == stt_device for device in DEVICES)
        valid_denoise_device = any(device["value"] == denoise_device for device in DEVICES)
        if not valid_stt_device:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid stt_device: {stt_device}. Device not found in available devices."
            )
        if not valid_denoise_device:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid denoise_device: {denoise_device}. Device not found in available devices."
            )
        
        CONFIG = {
            "language": data.language,
            "stt_device": stt_device,
            "stt_model": data.stt_model,
            "denoise_device": denoise_device,
            "denoise_model": data.denoise_model,
            "denoise_model_precision": data.denoise_model_precision
        }
        STT_PIPELINE, DENOISE_COMPILED_MODEL = initialize()
    except Exception as error:
        logger.error(f"Error in updating device: {str(error)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update device. Error: {error}"
        )

    return {"status": True}

@app.post("/v1/audio/transcriptions")
async def stt_transcription(
    file: UploadFile = File(...), 
    language: Optional[str] = Form(None), 
    use_denoise: Optional[bool] = Form(False)
):
    global STT_PIPELINE
    try:
        if file.filename:
            file_name, _ = os.path.splitext(file.filename)
            input_file_path = f"{TEMP_AUDIO_DIR}/{file_name}.webm"
        else:
            unique_filename = str(uuid.uuid4())
            input_file_path = f"{TEMP_AUDIO_DIR}/{unique_filename}.webm"

        with open(input_file_path, 'wb') as f:
            f.write(file.file.read())

        file_path = f"{TEMP_AUDIO_DIR}/{file_name}.wav"
        audio = AudioSegment.from_file(input_file_path, format="webm")
        audio = audio.set_sample_width(2)
        audio.export(file_path, format="wav")
        metrics = {}

        if use_denoise:
            logger.info("Denoising audio...")
            start_time = time.time()
            denoised_audio = denoise(DENOISE_COMPILED_MODEL, file_path)
            metrics["denoise_latency"] = time.time() - start_time
            with open(file_path, 'wb') as f:
                f.write(denoised_audio)

        if language is None:
            # logger.warning("Language is not set. Default to english.")
            language = STT_LANGUAGES[0] if CONFIG["language"] == "english" else STT_LANGUAGES[1]

        start_time = time.time()
        text = transcribe(
            pipeline=STT_PIPELINE,
            audio=file_path,
            language=language
        )
        metrics["stt_latency"] = time.time() - start_time

    except Exception as error:
        logger.error(f"Error in STT transcriptions: {str(error)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe the voice input. Error: {error}"
        )

    return {
        "text": text, 
        "metrics": metrics, 
        'status': True
    }

@app.post("/v1/audio/translations")
async def stt_translation(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    global STT_MODEL
    try:
        if file.filename:
            file_name, _ = os.path.splitext(file.filename)
            input_file_path = f"{TEMP_AUDIO_DIR}/{file_name}.webm"
        else:
            unique_filename = str(uuid.uuid4())
            input_file_path = f"{TEMP_AUDIO_DIR}/{unique_filename}.webm"

        with open(input_file_path, 'wb') as f:
            f.write(file.file.read())

        file_path = f"{TEMP_AUDIO_DIR}/{file_name}.wav"
        audio = AudioSegment.from_file(input_file_path, format="webm")
        audio.export(file_path, format="wav")

        if language == None:
            logger.warning("Language is not set. Default to english.")
            language = "english"

        text = translate(
            pipeline=STT_PIPELINE,
            audio=file_path,
            source_language=language
        )

    except Exception as error:
        logger.error(f"Error in STT translations: {str(error)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to translate the voice input. Error: {error}"
        )

    return {"text": text, 'status': True}


if __name__ == "__main__":
    import uvicorn
    import logging
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting server ...")
    uvicorn.run(app, host="0.0.0.0", port=8013)