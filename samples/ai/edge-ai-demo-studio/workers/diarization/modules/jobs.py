# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""In-memory async job store for diarization requests."""

import asyncio
import logging

logger = logging.getLogger("uvicorn.error")

# Cap to prevent unbounded memory growth
MAX_JOBS = 100
# Maximum number of jobs that may be queued/running at once.
# New submissions are rejected with 503 when this limit is reached.
MAX_PENDING_JOBS = 20

# Each job: {"status": "pending"|"completed"|"error", "result": ..., "error": ...}
_jobs: dict[str, dict] = {}


def evict_oldest_jobs() -> None:
    """Remove oldest completed/error jobs when the store exceeds MAX_JOBS."""
    if len(_jobs) <= MAX_JOBS:
        return
    removable = [jid for jid, j in _jobs.items() if j["status"] != "pending"]
    for jid in removable[: len(_jobs) - MAX_JOBS]:
        _jobs.pop(jid, None)


def pending_job_count() -> int:
    return sum(1 for j in _jobs.values() if j["status"] == "pending")


def create_job(job_id: str) -> None:
    _jobs[job_id] = {"status": "pending"}


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)


async def run_diarization_job(job_id: str, compute_fn, *args) -> None:
    """Background task that runs `compute_fn(*args)` in a thread and stores the result."""
    try:
        result = await asyncio.to_thread(compute_fn, *args)
        _jobs[job_id] = {"status": "completed", "result": result}
    except Exception as e:
        logger.error("Diarization job %s failed: %s", job_id, e)
        _jobs[job_id] = {"status": "error", "error": str(e)}
