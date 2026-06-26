# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import argparse
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Force UTF-8 on stdout/stderr so Unicode output (e.g. emoji in vendored code)
# doesn't crash the worker on Windows consoles that default to cp1252.
for _stream in (sys.stdout, sys.stderr):
    reconfigure = getattr(_stream, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")

import config
from schemas import CameraStartRequest, LoadModelRequest
from worker import OCRWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("paddleocr")

# Populated from CLI args in __main__; defaults let `uvicorn main:app` work too.
STARTUP = {
    "model": config.DEFAULT_MODEL,
    "device": config.DEFAULT_DEVICE,
    "autoload": True,
}

worker = OCRWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker.startup(
        default_model=STARTUP["model"],
        device=STARTUP["device"],
        autoload=STARTUP["autoload"],
    )
    yield
    worker.shutdown()


app = FastAPI(title="PaddleOCR Worker", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Health / devices ────────────────────────────────────────────────────────


@app.get("/healthcheck")
def healthcheck():
    info = worker.healthcheck()
    # Only report healthy (HTTP 200) once the model is fully loaded, so the
    # frontend marks the service "online" only when it can actually serve
    # inference. While the model is still loading (or if autoload failed) this
    # returns 503 and the frontend keeps the service in the "starting" state.
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
def load_model(req: LoadModelRequest):
    return worker.load_model(req.model, req.device, req.options)


# ── Image input — synchronous ─────────────────────────────────────────────────


@app.post("/ocr")
async def ocr(
    file: UploadFile = File(...),
    task: str = Query("ocr", description="VL task: ocr|table|formula|chart"),
    drop_score: float | None = Query(None, description="PP-OCR min confidence"),
    max_new_tokens: int | None = Query(None, description="VL generation cap"),
):
    """Synchronous OCR: blocks until inference finishes and returns the result.

    Simplest to call, but the HTTP request is held open for the whole pass —
    fine for fast PP-OCR models, less so for heavy VL models or flaky networks.
    For those, prefer the async submit-and-poll API (POST /ocr/jobs).
    """
    data = await file.read()
    return await run_in_threadpool(
        worker.run_image_bytes,
        data,
        task=task,
        drop_score=drop_score,
        max_new_tokens=max_new_tokens,
    )


# ── Image input — asynchronous (submit + poll) ────────────────────────────────


@app.post("/ocr/jobs")
async def submit_ocr_job(
    file: UploadFile = File(...),
    task: str = Query("ocr", description="VL task: ocr|table|formula|chart"),
    drop_score: float | None = Query(None, description="PP-OCR min confidence"),
    max_new_tokens: int | None = Query(None, description="VL generation cap"),
):
    """Asynchronous OCR: queue the image and return a job id immediately.

    Inference runs on a background worker; poll GET /ocr/jobs/{job_id} until the
    status becomes "done" (result populated) or "error". This keeps requests
    short and lets clients survive long-running passes without a held-open
    connection. Returns 503 here if no model is loaded.
    """
    data = await file.read()
    return worker.submit_image_job(
        data,
        task=task,
        drop_score=drop_score,
        max_new_tokens=max_new_tokens,
    )


@app.get("/ocr/jobs/{job_id}")
def get_ocr_job(job_id: str):
    """Poll the status/result of a job submitted via POST /ocr/jobs.

    Envelope: { job_id, status: pending|running|done|error, result, error }.
    Unknown or expired ids return 404.
    """
    return worker.get_job(job_id)


# ── Client camera stream (browser/client pushes frames) ─────────────────────


@app.websocket("/ocr/stream")
async def ocr_stream(
    ws: WebSocket,
    task: str = Query("ocr"),
    drop_score: float | None = Query(None),
    max_new_tokens: int | None = Query(None),
):
    await ws.accept()
    logger.info("Client stream connected")
    try:
        while True:
            data = await ws.receive_bytes()
            try:
                result = await run_in_threadpool(
                    worker.run_image_bytes,
                    data,
                    task=task,
                    drop_score=drop_score,
                    max_new_tokens=max_new_tokens,
                )
                await ws.send_json(result)
            except HTTPException as exc:
                await ws.send_json({"error": exc.detail, "status": exc.status_code})
    except WebSocketDisconnect:
        logger.info("Client stream disconnected")


# ── Server-side camera stream ───────────────────────────────────────────────


@app.post("/camera/start")
def camera_start(req: CameraStartRequest):
    return worker.camera_start(req.source)


@app.post("/camera/stop")
def camera_stop():
    return worker.camera_stop()


@app.get("/camera/status")
def camera_status():
    return worker.camera_status()


@app.get("/camera/stream")
def camera_stream(
    task: str = Query("ocr"),
    drop_score: float | None = Query(None),
):
    generator = worker.camera_mjpeg(task=task, drop_score=drop_score)
    return StreamingResponse(
        generator,
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="PaddleOCR Worker")
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
        help="OpenVINO device: AUTO|CPU|GPU|NPU (default AUTO).",
    )
    parser.add_argument(
        "--camera-source",
        default=config.DEFAULT_CAMERA_SOURCE,
        help="Default server-side camera source (index / path / URL).",
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
    config.DEFAULT_CAMERA_SOURCE = args.camera_source
    worker._camera_source = args.camera_source

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
