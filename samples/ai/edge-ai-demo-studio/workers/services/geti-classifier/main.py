# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import requests
import urllib3
from fastapi import FastAPI, File, UploadFile
from worker_common import base_parser, create_app, serve

sys.path.insert(0, str(Path(__file__).resolve().parent))

from schemas import (
    AutoSyncToggleRequest,
    FeedbackRequest,
    ModelsRequest,
    ProjectsRequest,
    SetupRequest,
)
from worker import GetiWorker

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
_original_request = requests.Session.request


def _patched_request(self, method, url, **kwargs):
    kwargs.setdefault("verify", False)
    return _original_request(self, method, url, **kwargs)


requests.Session.request = _patched_request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(
            stream=open(
                sys.stdout.fileno(),
                mode="w",
                encoding="utf-8",
                buffering=1,
                closefd=False,
            )
            if sys.platform == "win32"
            else sys.stdout
        )
    ],
)

worker = GetiWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await worker.startup()
    yield
    await worker.shutdown()


# /healthcheck reports the pipeline state (the demo reads it), so the route
# below stays this worker's own.
app = create_app(
    "Geti Worker",
    lifespan=lifespan,
    healthcheck=False,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
)


@app.get("/healthcheck")
def healthcheck():
    return worker.healthcheck()


@app.get("/devices")
def list_devices():
    return worker.get_devices()


@app.post("/projects")
def list_projects(req: ProjectsRequest):
    return worker.list_projects(req)


@app.post("/models")
def list_models(req: ModelsRequest):
    return worker.list_models(req)


# Setup takes minutes, so it runs as a background job (core/setup_jobs.py): POST .../jobs answers
# 202 at once, then GET /setup-jobs/{id} polls it or /events streams its stages.
@app.post("/setup-cls/jobs", status_code=202)
def start_setup_cls(req: SetupRequest):
    return worker.start_setup("cls", req)


@app.post("/setup-seg/jobs", status_code=202)
def start_setup_seg(req: SetupRequest):
    return worker.start_setup("seg", req)


@app.get("/setup-jobs/{job_id}")
def setup_job_status(job_id: str):
    return worker.setup_status(job_id)


@app.get("/setup-jobs/{job_id}/events")
def setup_job_events(job_id: str):
    return worker.setup_events(job_id)


# Blocking variants: start (or join) the job and answer with its SetupResponse when it ends.
@app.post("/setup-cls")
def setup_cls(req: SetupRequest):
    return worker.setup_cls(req)


@app.post("/setup-seg")
def setup_seg(req: SetupRequest):
    return worker.setup_seg(req)


@app.get("/model-info")
def model_info():
    return worker.get_model_info()


@app.post("/classify")
async def classify(file: UploadFile = File(...)):
    return await worker.classify(file)


@app.get("/image/{image_id}")
def get_image(image_id: str):
    return worker.get_image(image_id)


@app.post("/feedback")
def feedback(req: FeedbackRequest):
    return worker.feedback(req)


@app.get("/auto-sync/status")
def auto_sync_status():
    return worker.auto_sync_status()


@app.post("/auto-sync/toggle")
def auto_sync_toggle(req: AutoSyncToggleRequest):
    return worker.toggle_auto_sync(req)


if __name__ == "__main__":
    args = base_parser("Geti Worker", default_port=5017, device=False).parse_args()
    serve(app, args, log_level="info")
