# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi import FastAPI, HTTPException
from kokoro import KPipeline
import soundfile as sf
import torch
from speakers import SPEAKERS
from contextlib import asynccontextmanager
from typing import Optional
import json
import io
import os
from pydantic import BaseModel
import time
from uuid import uuid4
import uvicorn
import numpy as np

# 🇺🇸 'a' => American English, 🇬🇧 'b' => British English
# 🇪🇸 'e' => Spanish es
# 🇫🇷 'f' => French fr-fr
# 🇮🇳 'h' => Hindi hi
# 🇮🇹 'i' => Italian it
# 🇯🇵 'j' => Japanese: pip install misaki[ja]
# 🇧🇷 'p' => Brazilian Portuguese pt-br
# 🇨🇳 'z' => Mandarin Chinese: pip install misaki[zh]
LANGUAGES = ['a', 'e', 'f', 'h', 'i', 'j', 'p', 'z']

KOKOROTTS=None
MODEL_DIRECTORY = "models"
DATA_DIRECTORY = "data"
os.environ["HF_HOME"] = f"./{MODEL_DIRECTORY}"
os.environ["ESPEAK_DATA_PATH"]="/usr/lib/x86_64-linux-gnu/espeak-ng-data"

CONFIG = {
    "device" : "CPU",
    "speed": 1.0,
    "speaker": "af_heart",
    "language": "a"
}

class ISynthesize(BaseModel):
    text: str
    keep_file: Optional[bool] = None
    
class Configurations(BaseModel):
    device: Optional[str] = "CPU"
    speed: float
    language: str
    speaker: str
    
@asynccontextmanager
async def lifespan(app: FastAPI):
    global KOKOROTTS, CONFIG

    if not os.path.exists(MODEL_DIRECTORY):
        os.makedirs(MODEL_DIRECTORY)

    if not os.path.exists(DATA_DIRECTORY):
        os.makedirs(DATA_DIRECTORY)
        
    # KOKOROTTS = KPipeline(lang_code=CONFIG["language"])
    KOKOROTTS = KPipeline(lang_code='a')
    #warmup
    text = "The sky above the port was the color of television, tuned to a dead channel."
    generator = KOKOROTTS(
        text, voice=CONFIG["speaker"], # <= change voice here
        speed=CONFIG["speed"],
    )
    gs, ps, audio = next(generator)
    print(gs)
    print(ps) 
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
    global CONFIG, LANGUAGES, SPEAKERS
    config = {
        "languages": LANGUAGES,
        "speakers": SPEAKERS,
        "devices": ["CPU"],
        "selected_config": CONFIG
    }
    
    return JSONResponse(content=config)

@app.post("/v1/update_config")
async def update_config(data: Configurations):
    global CONFIG, KOKOROTTS
    try:
        if data.language not in LANGUAGES:
            raise HTTPException(status_code=404, detail=f"Language {data.language} not found")
        if data.speaker not in [speaker["name"] for speaker in SPEAKERS[data.language]]:
            raise HTTPException(status_code=404, detail=f"Speaker {data.speaker} not found")
        CONFIG["device"] = data.device
        CONFIG["speed"] = data.speed
        CONFIG["language"] = data.language
        CONFIG["speaker"] = data.speaker
        KOKOROTTS = KPipeline(lang_code=data.language)
    
        return JSONResponse(content={"message": "Configuration updated successfully"})
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/audio/speech")
async def synthesize(data: ISynthesize):
    global KOKOROTTS, CONFIG

    try:
        start_time = time.time()
        generator = KOKOROTTS(
            text=data.text, voice=CONFIG["speaker"],
            speed=CONFIG["speed"]
        )
        tts_latency = time.time() - start_time
        
        audio_chunks = []
        for gs, ps, audio in generator:
            audio_chunks.append(audio)
        if not audio_chunks:
            raise HTTPException(status_code=500, detail="No audio generated")
        combined_audio = np.concatenate(audio_chunks)
        
        if data.keep_file:
            duration = len(combined_audio) / 24000 
            
            filename =f"{uuid4()}.wav"
            sf.write(f"{DATA_DIRECTORY}/{filename}", combined_audio, 24000)  
            
            return JSONResponse(content={"filename": filename, "duration": duration, "inference_latency": tts_latency})
        else:
            wav_io = io.BytesIO()
            sf.write(wav_io, combined_audio, 24000)  
            wav_io.seek(0)
            return StreamingResponse(wav_io, media_type="audio/wav")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.environ.get('SERVER_HOST', "127.0.0.1"),
        port=int(os.environ.get('SERVER_PORT', "8013")),
        reload=True
    )