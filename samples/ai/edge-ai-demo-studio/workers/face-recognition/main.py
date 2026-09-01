# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import argparse
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Force UTF-8 on stdout/stderr so Unicode output doesn't crash the worker on
# Windows consoles that default to cp1252.
for _stream in (sys.stdout, sys.stderr):
    reconfigure = getattr(_stream, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")

import config
from schemas import LoadModelRequest
from worker import FaceRecognitionWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("face-recognition")

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


app = FastAPI(title="Face Recognition Worker", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


# ── Health / devices ────────────────────────────────────────────────────────


@app.get("/healthcheck")
def healthcheck():
    info = worker.healthcheck()
    # Only report healthy (HTTP 200) once the model is loaded, so the frontend
    # marks the service "online" only when it can actually serve inference.
    status_code = 200 if info.get("model_loaded") else 503
    return JSONResponse(info, status_code=status_code)


@app.get("/devices")
def devices():
    from core.device import get_available_devices

    return {"devices": get_available_devices()}


# ── Model management ────────────────────────────────────────────────────────


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


# ── Reference gallery ───────────────────────────────────────────────────────


@app.get("/gallery")
def list_gallery():
    return worker.list_gallery()


@app.post("/gallery")
async def enroll(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Enroll a person from one or more reference images.

    Re-using an existing name appends the images to that person, so a person
    can be enrolled incrementally with multiple reference shots. The original
    image bytes are kept so a later model swap re-embeds the gallery.
    """
    payload = [(f.filename or "image", await f.read()) for f in files]
    return await run_in_threadpool(worker.enroll, name, payload)


@app.delete("/gallery/{person_id}")
def delete_person(person_id: str):
    return worker.delete_person(person_id)


@app.delete("/gallery")
def clear_gallery():
    return worker.clear_gallery()


# ── Recognition ─────────────────────────────────────────────────────────────


@app.post("/recognize")
async def recognize(file: UploadFile = File(...)):
    """Detect all faces and match each against the enrolled gallery."""
    data = await file.read()
    return await run_in_threadpool(worker.recognize, data)


# ── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="Face Recognition Worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    parser.add_argument(
        "--model",
        default=config.DEFAULT_MODEL,
        help="Model preset to bring up on startup (see /models).",
    )
    parser.add_argument(
        "--device",
        default=config.DEFAULT_DEVICE,
        help="Device: AUTO|CPU|GPU|NPU (OpenVINO) or XPU (PyTorch fallback).",
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

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
