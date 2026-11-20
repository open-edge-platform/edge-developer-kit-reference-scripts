# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from audio_input_stream import get_silero_model, handle_audio_stream
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket
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
from modules.live import LiveDiarization
from modules.models import initialize_pipeline

logger = logging.getLogger("uvicorn.error")

CONFIG = {
    "port": 8026,
    "device": "cpu",
    "source": "huggingface",
}

DIARIZATION_PIPELINE = None
# Silero VAD for /v1/audio/stream: loaded at startup, retried on first use.
VAD_MODEL = None
VAD_LOCK = asyncio.Lock()


def _check_audio_size(audio_bytes: bytes) -> None:
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global DIARIZATION_PIPELINE
    logger.info("Initializing diarization worker...")
    DIARIZATION_PIPELINE = initialize_pipeline(CONFIG["device"], CONFIG["source"])
    # Loaded now so a live stream need not wait for it (a stream that does joins late). Only live
    # diarization needs it: a failure is retried when a stream connects.
    try:
        await _ensure_vad_model()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Silero VAD not loaded (live diarization unavailable for now): %s", exc)
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
    min_speakers: Optional[int] = Form(None),
    max_speakers: Optional[int] = Form(None),
    speaker_match_threshold: Optional[float] = Form(None),
):
    """Submit an async diarization job; poll ``GET /v1/diarize/{job_id}`` with the returned id.

    ``num_speakers`` fixes the count; otherwise ``min_speakers``/``max_speakers`` bound it (a live
    recording so far may hold fewer speakers than the whole one).
    """
    if DIARIZATION_PIPELINE is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization pipeline not loaded.",
        )
    for name, value in (
        ("num_speakers", num_speakers),
        ("min_speakers", min_speakers),
        ("max_speakers", max_speakers),
    ):
        if value is not None and value < 1:
            raise HTTPException(status_code=400, detail=f"{name} must be at least 1")
    if min_speakers is not None and max_speakers is not None and min_speakers > max_speakers:
        raise HTTPException(
            status_code=400, detail="min_speakers must not exceed max_speakers"
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
        min_speakers,
        max_speakers,
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


async def _ensure_vad_model():
    global VAD_MODEL
    async with VAD_LOCK:
        if VAD_MODEL is None:
            logger.info("Loading Silero VAD for live diarization ...")
            VAD_MODEL = await asyncio.to_thread(get_silero_model)
    return VAD_MODEL


@app.websocket("/v1/audio/stream")
async def audio_stream(websocket: WebSocket):
    """Live diarization of a microphone, on the speech-to-text worker's ``/v1/audio/stream``
    protocol (``audio_input_stream.stream``), so both cut the same utterances.

    Send ``{"event": "config", ...}`` (the ``/v1/diarize`` fields as JSON) before the audio. Each
    utterance is answered with ``{"type": "speakers", "segments", "covered_until", "start",
    "end"}``: every speaker turn of the session so far, re-clustered over the latest two
    minutes, and how far into the received audio that pass heard. Browsers connect to the
    worker port directly.
    """
    if DIARIZATION_PIPELINE is None:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "Diarization pipeline not loaded."})
        await websocket.close(code=1013)
        return
    try:
        vad_model = await _ensure_vad_model()
    except Exception as exc:  # noqa: BLE001
        logger.error("Silero VAD unavailable: %s", exc)
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": f"Voice activity detection unavailable: {exc}"})
        await websocket.close(code=1011)
        return
    await handle_audio_stream(
        websocket, vad_model=vad_model, processor=LiveDiarization(DIARIZATION_PIPELINE)
    )


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
