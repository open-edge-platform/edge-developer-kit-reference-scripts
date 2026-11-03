# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""In-memory async job store for diarization requests, and the one thread
every use of the pyannote pipeline runs on."""

import asyncio
import functools
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from itertools import count

from worker_common import CANCELLED, CancelToken, JobCancelled

logger = logging.getLogger("uvicorn.error")

# Cap to prevent unbounded memory growth
MAX_JOBS = 100
# Unfinished jobs allowed at once; further submissions get a 503.
MAX_PENDING_JOBS = 20

# Job states as GET /v1/diarize/{job_id} returns them: pending (stage "queued", `position` counting
# this one), running (stage, progress 0..1, maybe cancel_requested), completed (result, plus
# `perf` for the app's Live metrics), error, cancelled.
# Entries are replaced, never changed in place: the pipeline thread updates a running job while
# the event loop reads it.
_jobs: dict[str, dict] = {}
_UNFINISHED = frozenset({"pending", "running"})
_submitted = count()

# A waiting job's args are dropped when it starts or is cancelled, freeing its audio at once.
# `_start_lock` makes a waiting job either start or be cancelled, never both.
_cancel_tokens: dict[str, CancelToken] = {}
_waiting_args: dict[str, tuple] = {}
_start_lock = threading.Lock()

# The shared pipeline isn't thread-safe: diarization jobs and embedding requests take turns on
# this one thread, in arrival order.
_pipeline_thread = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pipeline")

# The event loop keeps only weak references to tasks: a job's task is held
# here until it ends, or it could be garbage-collected mid-run.
_job_tasks: set[asyncio.Task] = set()


def evict_oldest_jobs() -> None:
    """Remove oldest finished (completed, error, cancelled) jobs when the store exceeds MAX_JOBS."""
    if len(_jobs) <= MAX_JOBS:
        return
    removable = [jid for jid, j in list(_jobs.items()) if j["status"] not in _UNFINISHED]
    for jid in removable[: len(_jobs) - MAX_JOBS]:
        _jobs.pop(jid, None)


def pending_job_count() -> int:
    """Jobs not finished yet: waiting for the pipeline or running on it."""
    return sum(1 for j in list(_jobs.values()) if j["status"] in _UNFINISHED)


def create_job(job_id: str) -> None:
    _cancel_tokens[job_id] = CancelToken()
    _jobs[job_id] = {"status": "pending", "stage": "queued", "seq": next(_submitted)}


def get_job(job_id: str) -> dict | None:
    """The job's status as the API reports it, or None for an unknown job."""
    job = _jobs.get(job_id)
    if job is None:
        return None
    status = {k: v for k, v in job.items() if k != "seq"}
    if job["status"] == "pending":
        status["position"] = 1 + sum(
            1
            for other in list(_jobs.values())
            if other["status"] == "pending" and other["seq"] < job["seq"]
        )
    elif job["status"] == "running":
        token = _cancel_tokens.get(job_id)
        if token is not None and token.cancelled:
            status["cancel_requested"] = True
    return status


def cancel_job(job_id: str) -> dict | None:
    """Cancel a job and return its status, or None if unknown.

    A waiting job is cancelled at once, a running one at the pipeline's next step.
    """
    with _start_lock:
        job = _jobs.get(job_id)
        token = _cancel_tokens.get(job_id)
        if job is not None and token is not None:
            token.cancel()
            if job["status"] == "pending":
                _waiting_args.pop(job_id, None)
                _cancel_tokens.pop(job_id, None)
                _jobs[job_id] = {"status": CANCELLED}
    return get_job(job_id)


def is_finished(status: dict) -> bool:
    return status["status"] not in _UNFINISHED


async def run_on_pipeline(fn, *args, **kwargs):
    """``fn(*args, **kwargs)`` on the pipeline thread, after every call queued before it."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _pipeline_thread, functools.partial(fn, *args, **kwargs)
    )


def shutdown_pipeline() -> None:
    """Drop the calls still waiting for the pipeline, so stopping the worker
    does not first run every queued job."""
    _pipeline_thread.shutdown(wait=False, cancel_futures=True)


def start_diarization_job(job_id: str, compute_fn, *args) -> None:
    """Run ``compute_fn(*args, progress=...)`` for ``job_id`` in the background.

    After ``cancel_job``, the next ``progress`` report raises ``JobCancelled``, from inside the
    pipeline's ``hook=`` while it runs.
    """
    _waiting_args[job_id] = args
    task = asyncio.create_task(_run_job(job_id, compute_fn))
    _job_tasks.add(task)
    task.add_done_callback(_job_tasks.discard)


async def _run_job(job_id: str, compute_fn) -> None:
    token = _cancel_tokens.get(job_id) or CancelToken()

    def work():
        with _start_lock:
            args = _waiting_args.pop(job_id, None)
            if args is None:
                # Cancelled while it waited: already reported as such.
                return None
            _jobs[job_id] = {"status": "running", "progress": 0.0}
        # Timed from the moment the pipeline is free: `perf` measures the
        # processing, not the wait behind other jobs.
        started = time.time()

        def progress(stage: str, fraction: float) -> None:
            token.check()
            update = {"status": "running", "stage": stage, "progress": round(fraction, 3)}
            if _jobs.get(job_id) != update:
                _jobs[job_id] = update

        result = compute_fn(*args, progress=progress)
        return result, _perf(started, result)

    try:
        outcome = await run_on_pipeline(work)
        if outcome is not None:
            result, perf = outcome
            _jobs[job_id] = {
                "status": "completed",
                "progress": 1.0,
                "result": result,
                "perf": perf,
            }
    except JobCancelled:
        # Raised out of the pipeline mid-run; nothing it made is kept, and
        # the pipeline thread goes on to the next call.
        logger.info("Diarization job %s cancelled", job_id)
        _jobs[job_id] = {"status": CANCELLED}
    except Exception as e:
        logger.error("Diarization job %s failed: %s", job_id, e)
        _jobs[job_id] = {"status": "error", "error": str(e)}
    finally:
        _waiting_args.pop(job_id, None)
        _cancel_tokens.pop(job_id, None)


def _perf(started: float, result: object) -> dict:
    """Processing time of a job and, from the end of its last segment, the audio length."""
    perf = {"seconds": time.time() - started, "started": started}
    segments = result.get("segments") if isinstance(result, dict) else None
    if segments:
        audio_seconds = max(
            (float(seg.get("end") or 0.0) for seg in segments if isinstance(seg, dict)),
            default=0.0,
        )
        if audio_seconds > 0:
            perf["audio_seconds"] = audio_seconds
    return perf
