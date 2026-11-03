# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from worker_common import (
    base_parser,
    create_app,
    get_logger,
    serve,
    server_timing,
    sse_event,
    sse_response,
    timed,
    watch_status,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Force UTF-8 on stdout/stderr so Unicode output (e.g. emoji in vendored code)
# doesn't crash the worker on Windows consoles that default to cp1252.
for _stream in (sys.stdout, sys.stderr):
    reconfigure = getattr(_stream, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")

import config
from models import registry
from schemas import CameraStartRequest, LoadModelRequest
from worker import JOB_FINAL, OCRWorker

logger = get_logger("paddleocr")

# Populated from CLI args in __main__; defaults let `uvicorn main:app` work too.
STARTUP = {
    "model": config.DEFAULT_MODEL,
    "device": config.DEFAULT_DEVICE,
    "lang": config.DEFAULT_LANG,
    "autoload": True,
    "precision": None,
}

# --precision as PaddleOCR-VL language model load options (fp16 = uncompressed export). PP-OCR
# presets have no precision to choose.
PRECISION_OPTIONS = {
    "fp16": {"llm_int8": False, "llm_int4": False},
    "int8": {"llm_int8": True, "llm_int4": False},
    "int4": {"llm_int8": False, "llm_int4": True},
}


def _startup_options() -> dict | None:
    precision = STARTUP["precision"]
    spec = registry.REGISTRY.get(STARTUP["model"])
    if not precision or spec is None or spec.family != "vl":
        return None
    return PRECISION_OPTIONS[precision]

worker = OCRWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker.startup(
        default_model=STARTUP["model"],
        device=STARTUP["device"],
        autoload=STARTUP["autoload"],
        lang=STARTUP["lang"],
        options=_startup_options(),
    )
    yield
    worker.shutdown()


# /healthcheck is readiness-gated (503 until the model is loaded), so the
# route below stays this worker's own.
app = create_app(
    "PaddleOCR Worker",
    lifespan=lifespan,
    healthcheck=False,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
)


# Health / devices


@app.get("/healthcheck")
def healthcheck():
    info = worker.healthcheck()
    # 503 until the model is loaded, so the app shows "starting" until it can serve inference.
    status_code = 200 if info.get("model_loaded") else 503
    return JSONResponse(info, status_code=status_code)


@app.get("/devices")
def devices():
    from core.device import get_available_devices

    return {"devices": get_available_devices()}


# Model management


@app.get("/models")
def list_models():
    return worker.list_models()


@app.get("/languages")
def list_languages():
    """Recognition languages that can be passed as ?lang= on the OCR routes."""
    return worker.list_languages()


@app.get("/models/active")
def active_model():
    return worker.get_active()


@app.post("/models/load")
def load_model(req: LoadModelRequest):
    return worker.load_model(req.model, req.device, req.options, req.lang)


# Image input, synchronous


@app.post("/ocr")
async def ocr(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    task: str = Query("ocr", description="VL task: ocr|table|formula|chart"),
    lang: str | None = Query(
        None, description="Recognition language key (see GET /languages)"
    ),
    drop_score: float | None = Query(None, description="PP-OCR min confidence"),
    max_new_tokens: int | None = Query(None, description="VL generation cap"),
    stream: bool = Query(
        False, description="Stream the text as Server-Sent Events as it comes"
    ),
):
    """Synchronous OCR; with ``?stream=true``, SSE ``delta`` events then ``done`` or ``error``."""
    data = await file.read()
    options = {
        "task": task,
        "lang": lang,
        "drop_score": drop_score,
        "max_new_tokens": max_new_tokens,
    }
    if stream or "text/event-stream" in request.headers.get("accept", ""):
        # Decoding the image (and a 400 for a bad one) happens here, before
        # the stream starts; inference starts once the client reads it.
        events = await run_in_threadpool(worker.stream_image_bytes, data, **options)
        return sse_response(sse_event(body, event=name) for name, body in events)

    with timed() as clock:
        result = await run_in_threadpool(worker.run_image_bytes, data, **options)
    # The model time, for the app's Live metrics.
    response.headers.update(server_timing(clock.seconds))
    return result


# Image input, asynchronous (submit + poll)


@app.post("/ocr/jobs")
async def submit_ocr_job(
    file: UploadFile = File(...),
    task: str = Query("ocr", description="VL task: ocr|table|formula|chart"),
    lang: str | None = Query(
        None, description="Recognition language key (see GET /languages)"
    ),
    drop_score: float | None = Query(None, description="PP-OCR min confidence"),
    max_new_tokens: int | None = Query(None, description="VL generation cap"),
):
    """Queue an image for OCR and return a job id at once (503 if no model is loaded)."""
    data = await file.read()
    return worker.submit_image_job(
        data,
        task=task,
        lang=lang,
        drop_score=drop_score,
        max_new_tokens=max_new_tokens,
    )


@app.get("/ocr/jobs/{job_id}")
def get_ocr_job(job_id: str):
    """Poll a job's status, result and partial_text (404 if unknown or expired)."""
    return worker.get_job(job_id)


@app.delete("/ocr/jobs/{job_id}")
def cancel_ocr_job(job_id: str):
    """Cancel a job and return its envelope; a running VL generation stops at its next token."""
    return worker.cancel_job(job_id)


@app.get("/ocr/jobs/{job_id}/events")
def ocr_job_events(job_id: str):
    """Follow a job as Server-Sent ``status`` events until it finishes, instead of polling."""
    worker.get_job(job_id)  # 404 before the stream starts
    return sse_response(
        watch_status(
            lambda: worker.find_job(job_id),
            lambda status: status["status"] in JOB_FINAL,
        )
    )


# Client camera stream (the client pushes frames)


@app.websocket("/ocr/stream")
async def ocr_stream(
    ws: WebSocket,
    task: str = Query("ocr"),
    lang: str | None = Query(None),
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
                    lang=lang,
                    drop_score=drop_score,
                    max_new_tokens=max_new_tokens,
                )
                await ws.send_json(result)
            except HTTPException as exc:
                await ws.send_json({"error": exc.detail, "status": exc.status_code})
    except WebSocketDisconnect:
        logger.info("Client stream disconnected")


# Server-side camera stream


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
    lang: str | None = Query(None),
    drop_score: float | None = Query(None),
):
    generator = worker.camera_mjpeg(task=task, lang=lang, drop_score=drop_score)
    return StreamingResponse(
        generator,
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


if __name__ == "__main__":
    parser = base_parser(
        "PaddleOCR Worker",
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
        "--lang",
        default=config.DEFAULT_LANG,
        help=(
            "Default recognition language (see GET /languages). 'default' "
            "keeps the recogniser the chosen preset ships with. Every request "
            "can override it with ?lang=."
        ),
    )
    parser.add_argument(
        "--camera-source",
        default=config.DEFAULT_CAMERA_SOURCE,
        help="Default server-side camera source (index / path / URL).",
    )
    parser.add_argument(
        "--precision",
        default=None,
        choices=sorted(PRECISION_OPTIONS),
        help="PaddleOCR-VL language model weight format (default: int8); PP-OCR presets ignore it.",
    )
    parser.add_argument(
        "--no-autoload",
        action="store_true",
        help="Do not load the startup model until first /models/load.",
    )
    args = parser.parse_args()

    STARTUP["model"] = args.model
    STARTUP["device"] = args.device
    STARTUP["lang"] = args.lang
    STARTUP["autoload"] = not args.no_autoload
    STARTUP["precision"] = args.precision
    config.DEFAULT_CAMERA_SOURCE = args.camera_source
    worker._camera_source = args.camera_source

    serve(app, args, log_level="info")
