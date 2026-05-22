# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import requests
import urllib3
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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


app = FastAPI(title="Geti Worker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
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
    import uvicorn

    parser = argparse.ArgumentParser(description="Geti Worker")
    parser.add_argument("--port", type=int, default=5017)
    args = parser.parse_args()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")