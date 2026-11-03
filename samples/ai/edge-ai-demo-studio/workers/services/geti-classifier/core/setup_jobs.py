# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Geti setup as a background job, one running per model (cls / seg).

A setup (Geti builds the package; download, extract, compile) outlasts what clients wait for. The
same setup again joins the running job; a different one for that model gets 409 until it ends.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import HTTPException

from schemas import SetupRequest, SetupResponse

logger = logging.getLogger(__name__)

#: Stages a setup goes through, in order; ``error`` can follow any of them.
SETUP_STAGES = (
    "queued",
    "connecting",
    "preparing",
    "downloading",
    "extracting",
    "compiling",
    "done",
    "error",
)

#: Finished jobs kept for their status to stay readable.
MAX_FINISHED_JOBS = 20

#: Reports a stage (and optionally a message or download byte counts).
ProgressFn = Callable[..., None]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request_key(req: SetupRequest, device: str) -> str:
    """What makes two setup requests the same setup (the token hashed)."""
    parts = [
        req.host.strip().rstrip("/"),
        hashlib.sha256(req.token.encode("utf-8")).hexdigest(),
        req.project_id or "",
        req.project_name or "",
        req.model_id or "",
        device,
        str(req.verify_ssl),
    ]
    return "\x1f".join(parts)


class SetupJob:
    """One setup run: its status, updated from the thread running it."""

    def __init__(self, setup_type: str, req: SetupRequest, device: str) -> None:
        self.key = _request_key(req, device)
        self.finished = threading.Event()
        self._lock = threading.Lock()
        now = _now()
        self._status: dict[str, Any] = {
            "job_id": str(uuid.uuid4()),
            "setup_type": setup_type,
            "status": "running",
            "stage": "queued",
            "message": "Waiting to start",
            "bytes_downloaded": None,
            "bytes_total": None,
            "project_id": req.project_id,
            "project_name": req.project_name,
            "model_id": req.model_id,
            "device": device,
            "result": None,
            "error": None,
            "error_status": None,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }

    @property
    def job_id(self) -> str:
        return self._status["job_id"]

    @property
    def running(self) -> bool:
        return not self.finished.is_set()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._status)

    def progress(
        self,
        stage: str,
        message: str | None = None,
        *,
        bytes_downloaded: int | None = None,
        bytes_total: int | None = None,
    ) -> None:
        """Moves the job to ``stage``. Byte counts only mean something while
        downloading, so they are cleared on any other stage."""
        with self._lock:
            if self.finished.is_set():
                return
            status = self._status
            status["stage"] = stage
            if message is not None:
                status["message"] = message
            if stage == "downloading":
                status["bytes_downloaded"] = bytes_downloaded
                status["bytes_total"] = bytes_total
            else:
                status["bytes_downloaded"] = None
                status["bytes_total"] = None
            status["updated_at"] = _now()

    def succeed(self, result: SetupResponse) -> None:
        with self._lock:
            now = _now()
            self._status.update(
                status="done",
                stage="done",
                message=result.message,
                bytes_downloaded=None,
                bytes_total=None,
                result=result.model_dump(),
                updated_at=now,
                completed_at=now,
            )
        self.finished.set()

    def fail(self, detail: str, status_code: int = 500) -> None:
        with self._lock:
            now = _now()
            self._status.update(
                status="error",
                stage="error",
                message="Setup failed",
                bytes_downloaded=None,
                bytes_total=None,
                error=detail,
                error_status=status_code,
                updated_at=now,
                completed_at=now,
            )
        self.finished.set()


class SetupJobs:
    """The setup jobs of this worker, at most one running per setup type."""

    def __init__(
        self,
        run: Callable[[str, SetupRequest, str, ProgressFn], SetupResponse],
    ) -> None:
        # run(setup_type, req, device, progress) does the setup in the
        # calling thread and returns its result or raises.
        self._run = run
        self._lock = threading.Lock()
        self._jobs: OrderedDict[str, SetupJob] = OrderedDict()
        self._current: dict[str, SetupJob] = {}

    def start(self, setup_type: str, req: SetupRequest, device: str) -> SetupJob:
        """Starts a setup, or joins the identical one already running.

        Raises 409 while a different setup for the same model runs.
        """
        with self._lock:
            current = self._current.get(setup_type)
            if current is not None and current.running:
                if current.key == _request_key(req, device):
                    logger.info(
                        f"[setup-{setup_type}] Joining running setup "
                        f"{current.job_id}"
                    )
                    return current
                status = current.snapshot()
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": (
                            f"Another {_label(setup_type).lower()} setup is "
                            f"still running (stage: {status['stage']}). "
                            f"Wait for it to finish, then try again."
                        ),
                        "job": status,
                    },
                )

            job = SetupJob(setup_type, req, device)
            self._current[setup_type] = job
            self._jobs[job.job_id] = job
            self._prune()

        thread = threading.Thread(
            target=self._execute,
            args=(job, setup_type, req, device),
            name=f"geti-setup-{setup_type}",
            daemon=True,
        )
        thread.start()
        return job

    def get(self, job_id: str) -> SetupJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def status(self, job_id: str) -> dict[str, Any] | None:
        job = self.get(job_id)
        return job.snapshot() if job is not None else None

    def _execute(
        self,
        job: SetupJob,
        setup_type: str,
        req: SetupRequest,
        device: str,
    ) -> None:
        try:
            job.succeed(self._run(setup_type, req, device, job.progress))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            logger.warning(f"[setup-{setup_type}] Setup failed: {detail}")
            job.fail(detail, exc.status_code)
        except Exception as exc:  # the job must always finish
            logger.error(
                f"[setup-{setup_type}] Setup failed: {exc}", exc_info=True
            )
            job.fail(f"Setup failed: {exc}")

    def _prune(self) -> None:
        """Drops the oldest finished jobs beyond ``MAX_FINISHED_JOBS``."""
        finished = [jid for jid, job in self._jobs.items() if not job.running]
        for job_id in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]:
            del self._jobs[job_id]


def is_final(status: dict[str, Any]) -> bool:
    return status.get("status") in {"done", "error"}


def _label(setup_type: str) -> str:
    return "Classification" if setup_type == "cls" else "Segmentation"
