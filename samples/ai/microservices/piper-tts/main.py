# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
from fastapi import FastAPI, HTTPException, BackgroundTasks
from piper.voice import PiperVoice
from urllib.request import urlretrieve
import wave
import io
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from contextlib import asynccontextmanager
from typing import Optional, Literal
import json

import uvicorn
import os
from pydantic import BaseModel
from uuid import uuid4

PIPERTTS={
}
HF_DEFAULT_URL = "https://huggingface.co"
HF_MIRROR_URL = "https://hf-mirror.com"
hf_endpoint = os.getenv("HF_ENDPOINT", HF_DEFAULT_URL).strip()
allowed_endpoints = {
    HF_DEFAULT_URL: HF_DEFAULT_URL,
    HF_MIRROR_URL: HF_MIRROR_URL
}
huggingface_endpoint = allowed_endpoints.get(hf_endpoint, HF_DEFAULT_URL)
DOWNLOAD_URL = f"{huggingface_endpoint.rstrip('/')}/rhasspy/piper-voices/resolve/v1.0.0"
MODEL_DIRECTORY = "models"
DATA_DIRECTORY = "data"

MODELS =  {
    "female": "en/en_US/hfc_female/medium/en_US-hfc_female-medium", 
    "male": "en/en_US/hfc_male/medium/en_US-hfc_male-medium"
}
CONFIG = {
    "device" : "CPU",
    "speed": 1.0,
    "speaker": "male"
}

class ISynthesize(BaseModel):
    text: str
    length_scale: Optional[float] = None
    speaker:Optional[str] = None
    keep_file: Optional[bool] = None

class Configurations(BaseModel):
    device: Optional[str] = "CPU"
    speed: float    # aka length_scale
    speaker: Literal[tuple(list(MODELS.keys()))]

@asynccontextmanager
async def lifespan(app: FastAPI):
    global PIPERTTS, MODELS

    if not os.path.exists(MODEL_DIRECTORY):
        os.makedirs(MODEL_DIRECTORY)

    if not os.path.exists(DATA_DIRECTORY):
        os.makedirs(DATA_DIRECTORY)
    
    for key, value in MODELS.items():
        model_name = value.split("/")[-1]
        
        # Download the model file if it doesn't exist
        model_file_path = os.path.join(MODEL_DIRECTORY, f"{model_name}.onnx")
        if not os.path.exists(model_file_path):
            model_download_path = f"{DOWNLOAD_URL}/{value}.onnx"
            urlretrieve(f"{model_download_path}", model_file_path)  # nosec --http file
        
        # Download the model config file if it doesn't exist
        model_config_file_path = os.path.join(MODEL_DIRECTORY, f"{model_name}.onnx.json")
        if not os.path.exists(model_config_file_path):
            model_config_path = f"{DOWNLOAD_URL}/{value}.onnx.json"
            urlretrieve(f"{model_config_path}", model_config_file_path)  # nosec --http file

        voice = PiperVoice.load(os.path.join(MODEL_DIRECTORY, f"{model_name}.onnx"))
        PIPERTTS[key] = voice
    yield

allowed_cors =  json.loads(os.getenv("ALLOWED_CORS", '["http://localhost:3000"]'))
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
    global CONFIG
    config = {
        "speaker": list(MODELS.keys()),
        "devices": ["CPU"],
        "selected_config": CONFIG
    }
    
    return JSONResponse(content=config)

@app.post("/v1/update_config")
async def update_config(data: Configurations):
    global CONFIG
    try:
        if data.speaker not in PIPERTTS:
            raise HTTPException(status_code=404, detail=f"Speaker {data.speaker} not found")
        CONFIG["device"] = data.device
        CONFIG["speed"] = data.speed
        CONFIG["speaker"] = data.speaker
        return JSONResponse(content={"message": "Configuration updated successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/audio/speech")
async def synthesize(data: ISynthesize, background_tasks: BackgroundTasks):
    global PIPERTTS, CONFIG
    speaker = data.speaker if data.speaker else CONFIG["speaker"]
    if speaker not in PIPERTTS:
        raise HTTPException(status_code=404, detail=f"Speaker {speaker} not found")
    try:
        wav_io = io.BytesIO()
        
        start_time = time.time()
        with wave.open(wav_io, "wb") as wav_file:
            PIPERTTS[speaker].synthesize(data.text, wav_file, length_scale=data.length_scale if data.length_scale else CONFIG["speed"])
        tts_latency = time.time() - start_time
        wav_io.seek(0)
        if data.keep_file:
            with wave.open(wav_io, "rb") as wav_file:
                frames = wav_file.getnframes()
                rate = wav_file.getframerate()
                duration = frames / float(rate)
                wav_io.seek(0)
            filename =f"{uuid4()}.wav"
            with open(f"{DATA_DIRECTORY}/{filename}", "wb") as f:
                f.write(wav_io.read())
            wav_io.close()
            return JSONResponse(content={"filename": filename, "duration": duration, "inference_latency": tts_latency})
        else:
            background_tasks.add_task(lambda: wav_io.close())
            return StreamingResponse(wav_io, media_type="audio/wav")
    except Exception as e:
        wav_io.close()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.environ.get('SERVER_HOST', "127.0.0.1"),
        port=int(os.environ.get('SERVER_PORT', "8013")),
        reload=True
    )