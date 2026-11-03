# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from worker_common import base_parser, create_app, serve, sse_response, watch_status

from modules.audio import MAX_AUDIO_SIZE
from modules.diarization import compute_diarization, compute_embedding
from modules.jobs import (
    MAX_PENDING_JOBS,
    cancel_job,
    create_job,
    evict_oldest_jobs,
    get_job,
    is_finished,
    pending_job_count,
    run_on_pipeline,
    shutdown_pipeline,
    start_diarization_job,
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
    shutdown_pipeline()


app = create_app("Diarization Worker", lifespan=lifespan)


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
        # Waits for the diarization job using the pipeline, if any.
        return await run_on_pipeline(
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
    """Submit an async diarization job; poll ``GET /v1/diarize/{job_id}`` with the returned id."""
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

    start_diarization_job(
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

    return {"job_id": job_id}


@app.get("/v1/diarize/{job_id}")
async def get_diarize_status(job_id: str):
    """Status of an async diarization job: pending, running, completed, error or cancelled."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.delete("/v1/diarize/{job_id}")
async def cancel_diarize_job(job_id: str):
    """Cancel a diarization job and return its status; a running job stops at its next step."""
    job = cancel_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/v1/diarize/{job_id}/events")
async def diarize_status_events(job_id: str):
    """Follow a diarization job's status as Server-Sent Events, ending after its final one."""
    if get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return sse_response(watch_status(lambda: get_job(job_id), is_finished))


def parse_args():
    return base_parser("Diarization Worker", default_port=8026, source=True).parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["port"] = args.port
    CONFIG["device"] = args.device.lower()
    CONFIG["source"] = args.source

    serve(app, args)


if __name__ == "__main__":
    main()
