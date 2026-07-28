# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from modules.audio import MAX_AUDIO_SIZE
from modules.diarization import compute_diarization, compute_embedding
from modules.jobs import (
    MAX_PENDING_JOBS,
    create_job,
    evict_oldest_jobs,
    get_job,
    pending_job_count,
    run_diarization_job,
)
from modules.models import initialize_pipeline

logger = logging.getLogger("uvicorn.error")

CONFIG = {
    "port": 8026,
    "device": "cpu",
    "source": "huggingface",
}

DIARIZATION_PIPELINE = None


def _check_audio_size(audio_bytes: bytes) -> None:
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global DIARIZATION_PIPELINE
    logger.info("Initializing diarization worker...")
    DIARIZATION_PIPELINE = initialize_pipeline(CONFIG["device"], CONFIG["source"])
    yield
    logger.info("Shutting down diarization worker.")


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck")
def get_healthcheck():
    return "OK"


@app.post("/v1/embedding")
async def create_embedding(
    file: UploadFile = File(...),
):
    """Generate a normalized speaker embedding vector from an audio file."""
    if DIARIZATION_PIPELINE is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization pipeline not loaded.",
        )

    try:
        audio_bytes = await file.read()
        _check_audio_size(audio_bytes)
        return await asyncio.to_thread(
            compute_embedding, DIARIZATION_PIPELINE, audio_bytes
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error generating embedding: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to generate embedding"
        ) from e


@app.post("/v1/diarize")
async def diarize_audio(
    file: UploadFile = File(...),
    reference_embedding: Optional[str] = Form(None),
    reference_label: str = Form("Reference"),
    other_label: str = Form("Other"),
    speaker_profiles: Optional[str] = Form(None),
    unknown_label: str = Form("Unknown"),
    num_speakers: Optional[int] = Form(None),
    speaker_match_threshold: Optional[float] = Form(None),
):
    """Submit an async diarization job.

    Returns a job ID immediately.  Poll ``GET /v1/diarize/{job_id}``
    to retrieve the status and results.

    Supports two modes for speaker identification:

    **Multi-speaker mode** (preferred): Pass ``speaker_profiles`` as a
    JSON-encoded array of ``{"label": str, "embedding": list[float]}``
    objects.  Each detected speaker is matched to the closest profile
    above the similarity threshold; unmatched speakers are labelled
    with ``unknown_label``.

    **Legacy single-speaker mode**: Pass ``reference_embedding`` (a
    JSON-encoded list of floats) together with ``reference_label`` and
    ``other_label``.

    Returns:
        {"job_id": str}
    """
    if DIARIZATION_PIPELINE is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization pipeline not loaded.",
        )

    audio_bytes = await file.read()
    _check_audio_size(audio_bytes)

    evict_oldest_jobs()
    if pending_job_count() >= MAX_PENDING_JOBS:
        raise HTTPException(
            status_code=503,
            detail="Server busy: too many pending jobs. Try again later.",
        )

    job_id = uuid.uuid4().hex
    create_job(job_id)

    asyncio.create_task(
        run_diarization_job(
            job_id,
            compute_diarization,
            DIARIZATION_PIPELINE,
            audio_bytes,
            reference_embedding,
            reference_label,
            other_label,
            speaker_profiles,
            unknown_label,
            num_speakers,
            speaker_match_threshold,
        )
    )

    return {"job_id": job_id}


@app.get("/v1/diarize/{job_id}")
async def get_diarize_status(job_id: str):
    """Check the status of an async diarization job.

    Returns:
        - ``{"status": "pending"}`` while processing
        - ``{"status": "completed", "result": {"segments": [...]}}`` on success
        - ``{"status": "error", "error": "..."}`` on failure
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def parse_args():
    parser = argparse.ArgumentParser(description="Diarization Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=8026,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run models on (e.g. cpu, xpu, xpu:0, xpu:1)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model source repository",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["port"] = args.port
    CONFIG["device"] = args.device.lower()
    CONFIG["source"] = args.source

    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
