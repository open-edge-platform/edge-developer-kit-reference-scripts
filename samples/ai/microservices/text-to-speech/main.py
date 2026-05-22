# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import uuid
import time
import json
import logging
from typing import Optional

from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from starlette.background import BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path

import nltk
import openvino as ov
from melo.api import TTS

TTS_DEVICE = os.getenv("TTS_DEVICE", "CPU")
BERT_DEVICE = os.getenv("BERT_DEVICE", "CPU")
USE_INT8 = True if os.getenv("USE_INT8", "False") == "True" else False
LANGUAGE = os.getenv("LANGUAGE", "EN")

# Variables
TTS_MODEL = None
TTS_SPEAKER_IDS = None
AUDIO_SAVE_PATH = os.getenv("AUDIO_SAVE_PATH", "./tmp_audio")
MODEL_PATH = os.getenv("MODEL_PATH", "./data/models/text-to-speech")
LOGGER = logging.getLogger('uvicorn.error')


def _reshape_for_npu(model_path, bert_static_shape, save_path):
    core = ov.Core()
    model = core.read_model(model_path)
    shapes = dict()
    for input_layer in model.inputs:
        shapes[input_layer] = bert_static_shape
    model.reshape(shapes)
    ov.save_model(model, save_path)


def _verify_device():
    global TTS_DEVICE, BERT_DEVICE
    LOGGER.info("Sanity checking for device ...")
    
    core = ov.Core()
    device_list = core.available_devices
    LOGGER.info(f"Available devices on system: {device_list}")

    supported_tts_device = ["CPU", "GPU"]
    if TTS_DEVICE.upper().split(".")[0] not in supported_tts_device:
        raise ValueError(
            f"Invalid TTS Device: {TTS_DEVICE}. Supported Devices: {supported_tts_device}"
        )
    
    supported_stt_device = ["CPU", "GPU", "NPU"]
    if BERT_DEVICE.upper().split(".")[0] not in supported_stt_device:
        raise ValueError(
            f"Invalid BERT Device: {BERT_DEVICE}. Supported Devices: {supported_stt_device}"
        )
    
    if USE_INT8 == True:
        if "GPU" in TTS_DEVICE.upper() or "GPU" in BERT_DEVICE.upper():
            raise ValueError(
                "INT8 precision is not supported on GPU device. Please use CPU or NPU."
            )


def load_model():
    global LOGGER, LANGUAGE, TTS_DEVICE, BERT_DEVICE, USE_INT8, TTS_SPEAKER_IDS
    LOGGER.info(
        f"Loading model with language: {LANGUAGE}, TTS Device: {TTS_DEVICE}, BERT Device: {BERT_DEVICE}, USE_INT8: {USE_INT8}"
    )
    model = TTS(
        language=LANGUAGE,
        tts_device=TTS_DEVICE,
        bert_device=BERT_DEVICE,
        use_int8=USE_INT8
    )
    TTS_SPEAKER_IDS = model.hps.data.spk2id
    return model


def optimize_model(model):
    global LOGGER, MODEL_PATH, BERT_DEVICE, USE_INT8, LANGUAGE
    if not os.path.exists(MODEL_PATH):
        os.makedirs(Path(MODEL_PATH), exist_ok=True)

    if BERT_DEVICE.upper() == "NPU":
        if not USE_INT8:
            LOGGER.warning(
                "Running BERT model on NPU requires int8 precision.")
            USE_INT8 = True

    if USE_INT8:
        if not os.path.exists(f"{MODEL_PATH}/bert_int8_{LANGUAGE}.xml") or not os.path.exists(f"{MODEL_PATH}/tts_{LANGUAGE}.xml"):
            LOGGER.info("Optimizing model to OpenVINO int8 format ...")
            model.tts_convert_to_ov(MODEL_PATH, language=LANGUAGE)
        if BERT_DEVICE.upper() == "NPU" and not os.path.exists(f"{MODEL_PATH}/bert_int8_static_{LANGUAGE}.xml"):
            LOGGER.info("Optimizing BERT model for NPU ...")
            bert_static_shape = [1, 32]
            save_path = f"{MODEL_PATH}/bert_int8_static_{LANGUAGE}.xml"
            _reshape_for_npu(
                f"{MODEL_PATH}/bert_{LANGUAGE}.xml",
                bert_static_shape,
                save_path
            )
    else:
        if not os.path.exists(f"{MODEL_PATH}/bert_{LANGUAGE}.xml") or not os.path.exists(f"{MODEL_PATH}/tts_{LANGUAGE}.xml"):
            LOGGER.info("Optimizing model to OpenVINO format ...")
            model.tts_convert_to_ov(MODEL_PATH, language=LANGUAGE)

    model.ov_model_init(MODEL_PATH, language=LANGUAGE)
    return model


def warmup_model(model, speaker_ids):
    LOGGER.info("Running model warmup ...")
    text = "How is your day today?"
    voice = "EN-US"
    output_path = "output.wav"
    model.tts_to_file(text, speaker_ids[voice],
                      output_path, speed=1, use_ov=True)
    os.remove(output_path)
    LOGGER.info("Model warmup completed ...")


def download_nltk_packages():
    LOGGER.info("Downloading NLTK packages ...")
    if not os.path.exists("./data/nltk_data/corpora/cmudict"):
        nltk.download('cmudict')

    if not os.path.exists("./data/nltk_data/taggers/averaged_perceptron_tagger"):
        nltk.download('averaged_perceptron_tagger')

    if not os.path.exists("./data/nltk_data/taggers/averaged_perceptron_tagger_eng"):
        nltk.download('averaged_perceptron_tagger_eng')


def startup():
    global AUDIO_SAVE_PATH, TTS_MODEL
    _verify_device()
    if not os.path.exists(AUDIO_SAVE_PATH):
        os.makedirs(Path(AUDIO_SAVE_PATH))

    download_nltk_packages()
    TTS_MODEL = load_model()
    TTS_MODEL = optimize_model(TTS_MODEL)
    if TTS_MODEL == None:
        raise RuntimeError("Failed to load model.")

    warmup_model(TTS_MODEL, TTS_SPEAKER_IDS)


def clean_up():
    LOGGER.info("Cleaning up before closing.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup()
    yield
    clean_up()


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class TTSData(BaseModel):
    input: str
    model: str = '-'
    voice: Optional[str] = 'EN-US'
    response_format: Optional[str] = 'wav'  # [mp3, opus, aac, flac, wav, pcm]
    speed: Optional[float] = 1.0  # [0.25 - 4.0]


class TTSModel(BaseModel):
    language: str = "EN"
    device: str = "cpu"


@app.post("/v1/audio/speech")
async def speech_to_text(data: TTSData, bg_task: BackgroundTasks):
    global LOGGER, TTS_MODEL, TTS_SPEAKER_IDS

    async def remove_file(file_name):
        if os.path.exists(file_name):
            try:
                os.remove(file_name)
            except Exception as error:
                LOGGER.error(
                    f"Failed to remove file: {file_name}. Error: {error}"
                )

    if data.voice == "":
        data.voice = "EN-US"

    if TTS_MODEL == None or TTS_SPEAKER_IDS == None:
        raise HTTPException(
            status_code=403, detail="Model is not loaded. Please call the /v1/")

    output_path = f"{AUDIO_SAVE_PATH}/{str(uuid.uuid4())}.wav"

    start_time = time.time()
    TTS_MODEL.tts_to_file(
        data.input,
        TTS_SPEAKER_IDS[data.voice],
        output_path,
        speed=data.speed,
        use_ov=True
    )
    elapsed_time = time.time() - start_time
    LOGGER.info(
        f"[TTS: {TTS_DEVICE}][BERT: {BERT_DEVICE}] - TTS Inference Time: {elapsed_time:.2} secs"
    )

    if os.path.isfile(output_path):
        return FileResponse(output_path, media_type="audio/wav", background=bg_task.add_task(remove_file, output_path))
    else:
        raise HTTPException(
            status_code=500, detail="Error in getting the generated output wav.")


@app.get('/healthcheck', status_code=200)
def get_healthcheck():
    return 'OK'


@app.get("/")
async def root():
    return {"message": "Hello World"}
