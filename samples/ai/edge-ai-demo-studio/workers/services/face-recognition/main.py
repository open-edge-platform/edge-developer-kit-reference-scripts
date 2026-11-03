# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from worker_common import base_parser, create_app, get_logger, serve, server_timing
from worker_common.devices import openvino_devices

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config
from schemas import LoadModelRequest
from worker import FaceRecognitionWorker

logger = get_logger("face-recognition")

# Populated from CLI args in __main__; defaults let `uvicorn main:app` work too.
STARTUP = {
    "model": config.DEFAULT_MODEL,
    "device": config.DEFAULT_DEVICE,
    "autoload": True,
}

worker = FaceRecognitionWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker.startup(
        default_model=STARTUP["model"],
        device=STARTUP["device"],
        autoload=STARTUP["autoload"],
    )
    yield
    worker.shutdown()


# /healthcheck is readiness-gated (503 until the model is loaded), so the
# route below stays this worker's own.
app = create_app(
    "Face Recognition Worker",
    lifespan=lifespan,
    healthcheck=False,
    allow_methods=["GET", "POST", "DELETE"],
)


@app.get("/healthcheck")
def healthcheck():
    info = worker.healthcheck()
    status_code = 200 if info.get("model_loaded") else 503
    return JSONResponse(info, status_code=status_code)


@app.get("/devices")
def devices():
    return {"devices": openvino_devices()}


@app.get("/models")
def list_models():
    return worker.list_models()


@app.get("/models/active")
def active_model():
    return worker.get_active()


@app.post("/models/load")
async def load_model(req: LoadModelRequest):
    return await run_in_threadpool(
        worker.load_model, req.model, req.device, req.options
    )


@app.get("/gallery")
def list_gallery():
    return worker.list_gallery()


@app.post("/gallery")
async def enroll(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Enroll a person from reference images; an existing name gets the images appended."""
    payload = [(f.filename or "image", await f.read()) for f in files]
    return await run_in_threadpool(worker.enroll, name, payload)


@app.delete("/gallery/{person_id}")
def delete_person(person_id: str):
    return worker.delete_person(person_id)


@app.delete("/gallery")
def clear_gallery():
    return worker.clear_gallery()


@app.post("/recognize")
async def recognize(response: Response, file: UploadFile = File(...)):
    """Detect all faces and match each against the enrolled gallery."""
    data = await file.read()
    result = await run_in_threadpool(worker.recognize, data)
    # The detect + embed time measured around the model, for the app's Live metrics.
    response.headers.update(server_timing(float(result.get("elapsed_ms", 0.0)) / 1000))
    return result


if __name__ == "__main__":
    parser = base_parser(
        "Face Recognition Worker",
        default_port=config.DEFAULT_PORT,
        host=True,
        default_device=config.DEFAULT_DEVICE,
        device_help="OpenVINO device: AUTO|CPU|GPU|NPU (default AUTO).",
    )
    parser.add_argument(
        "--model",
        default=config.DEFAULT_MODEL,
        help="Model preset to bring up on startup (see /models).",
    )
    parser.add_argument(
        "--no-autoload",
        action="store_true",
        help="Do not load the startup model until first /models/load.",
    )
    args = parser.parse_args()

    STARTUP["model"] = args.model
    STARTUP["device"] = args.device
    STARTUP["autoload"] = not args.no_autoload

    serve(app, args, log_level="info")
