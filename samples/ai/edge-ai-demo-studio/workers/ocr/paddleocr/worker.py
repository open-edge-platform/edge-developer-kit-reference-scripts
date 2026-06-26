# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Orchestrator that ties the model registry, devices, and camera together.

``main.py`` holds only FastAPI routing; every route delegates to one method
here. This class owns the single *active* model and serialises model swaps so a
load in flight never races an inference.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Iterator

import numpy as np
from fastapi import HTTPException

from config import (
    CAMERA_MIN_INFER_INTERVAL_MS,
    DEFAULT_CAMERA_SOURCE,
    DEFAULT_DEVICE,
    OCR_JOB_TTL_SECONDS,
)
from core import device as device_mod
from core.camera import ServerCamera
from core.image_io import ImageDecodeError, decode_image
from models import registry
from models.base import BaseOCRModel
from models.result import OCRResult

logger = logging.getLogger(__name__)

# Async job states. A job moves pending -> running -> (done | error).
JOB_PENDING = "pending"
JOB_RUNNING = "running"
JOB_DONE = "done"
JOB_ERROR = "error"


@dataclass
class OCRJob:
    """One queued async OCR request (see ``OCRWorker.submit_image_job``)."""

    id: str
    status: str = JOB_PENDING
    result: dict[str, Any] | None = None
    error: str | None = None
    status_code: int = 200
    finished_at: float | None = None  # monotonic time terminal state was reached

    def public(self) -> dict[str, Any]:
        """Client-facing envelope returned by the poll endpoint."""
        return {
            "job_id": self.id,
            "status": self.status,
            "result": self.result,
            "error": self.error,
        }


class OCRWorker:
    def __init__(self) -> None:
        self._device = DEFAULT_DEVICE
        self._model: BaseOCRModel | None = None
        self._model_key: str | None = None
        self._swap_lock = threading.Lock()
        self._camera = ServerCamera(CAMERA_MIN_INFER_INTERVAL_MS)
        self._camera_source: str = DEFAULT_CAMERA_SOURCE
        # Async job queue: a single worker thread serialises inference (the edge
        # box runs one model at a time), and results are parked in `_jobs` until
        # the client polls for them or they age out (OCR_JOB_TTL_SECONDS).
        self._jobs: dict[str, OCRJob] = {}
        self._jobs_lock = threading.Lock()
        self._job_pool = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="ocr-job"
        )

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def startup(
        self,
        default_model: str,
        device: str | None = None,
        autoload: bool = True,
    ) -> None:
        self._device = device_mod.normalize_device(device or DEFAULT_DEVICE)
        logger.info("=" * 60)
        for d in device_mod.get_available_devices():
            logger.info(f"  {d['name']:8s} | {d['full_name']}")
        logger.info(f"  default device requested: {self._device}")
        logger.info("=" * 60)

        if autoload:
            try:
                self.load_model(default_model, self._device)
            except Exception as exc:
                # Fail hard: a startup model that can't load means the worker
                # cannot serve. Re-raise so the FastAPI lifespan startup fails
                # and the process exits non-zero instead of running half-broken.
                logger.error(f"Autoload of '{default_model}' failed: {exc}")
                raise

    def shutdown(self) -> None:
        self._camera.stop()
        self._job_pool.shutdown(wait=False, cancel_futures=True)
        if self._model is not None:
            self._model.release()
        logger.info("PaddleOCR worker shut down")

    # ── Model management ───────────────────────────────────────────────────

    def load_model(
        self,
        key: str,
        device: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            target_device = device_mod.normalize_device(device or self._device)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            new_model = registry.create_model(key, target_device, options)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        # Load outside the swap lock (slow: may download/convert) but serialise
        # concurrent loads so two requests don't both build a model.
        with self._swap_lock:
            try:
                new_model.ensure_loaded()
            except Exception as exc:
                logger.error(f"Failed to load '{key}': {exc}", exc_info=True)
                raise HTTPException(
                    status_code=500, detail=f"Failed to load '{key}': {exc}"
                )
            old = self._model
            self._model = new_model
            self._model_key = key
            self._device = target_device

        if old is not None and old is not new_model:
            old.release()
        logger.info(f"Active model -> {key} on {target_device}")
        return self.get_active()

    def list_models(self) -> dict[str, Any]:
        return {
            "active": self._model_key,
            "device": self._device,
            "available": registry.list_specs(),
        }

    def get_active(self) -> dict[str, Any]:
        if self._model is None:
            return {"active": None, "loaded": False}
        info = self._model.info()
        info["active"] = self._model_key
        return info

    def _require_model(self) -> BaseOCRModel:
        if self._model is None or not self._model.loaded:
            raise HTTPException(
                status_code=503,
                detail="No model loaded. Call POST /models/load first.",
            )
        return self._model

    # ── Health ─────────────────────────────────────────────────────────────

    def healthcheck(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "active_model": self._model_key,
            "model_loaded": self._model is not None and self._model.loaded,
            "device": self._device,
            "camera_running": self._camera.is_running,
            "camera_source": self._camera.source,
        }

    # ── Inference ──────────────────────────────────────────────────────────

    def run_image_bytes(self, data: bytes, **kwargs: Any) -> dict[str, Any]:
        try:
            image = decode_image(data)
        except ImageDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return self._infer_image(image, **kwargs).to_dict()

    def _infer_image(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        model = self._require_model()
        try:
            return model.infer(image, **self._clean_kwargs(kwargs))
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            logger.error(f"Inference error: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Inference error: {exc}")

    @staticmethod
    def _clean_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
        """Drop None values so model defaults apply."""
        return {k: v for k, v in kwargs.items() if v is not None}

    def infer_frame(self, frame: np.ndarray, **kwargs: Any) -> OCRResult | None:
        """Best-effort inference for stream loops; returns None if unavailable."""
        if self._model is None or not self._model.loaded:
            return None
        return self._model.infer(frame, **self._clean_kwargs(kwargs))

    # ── Async (submit + poll) inference ────────────────────────────────────

    def submit_image_job(self, data: bytes, **kwargs: Any) -> dict[str, Any]:
        """Queue an image for OCR and return immediately with a job envelope.

        The actual inference runs on a single background worker thread; the
        client polls ``get_job`` with the returned ``job_id`` until the status
        is ``done`` (``result`` populated) or ``error`` (``error`` populated).
        """
        # Fail fast on the common "no model loaded" case so the caller gets a
        # 503 from the submit call rather than having to poll to discover it.
        self._require_model()

        self._evict_expired_jobs()
        job = OCRJob(id=uuid.uuid4().hex)
        with self._jobs_lock:
            self._jobs[job.id] = job
        self._job_pool.submit(self._run_job, job, data, kwargs)
        return job.public()

    def _run_job(self, job: OCRJob, data: bytes, kwargs: dict[str, Any]) -> None:
        with self._jobs_lock:
            job.status = JOB_RUNNING
        try:
            result = self.run_image_bytes(data, **kwargs)
            self._finish_job(job, result=result)
        except HTTPException as exc:
            self._finish_job(job, error=str(exc.detail), status_code=exc.status_code)
        except Exception as exc:  # defensive: never let a job thread die silently
            logger.error(f"Async job {job.id} failed: {exc}", exc_info=True)
            self._finish_job(job, error=str(exc), status_code=500)

    def _finish_job(
        self,
        job: OCRJob,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        status_code: int = 200,
    ) -> None:
        with self._jobs_lock:
            job.result = result
            job.error = error
            job.status_code = status_code
            job.status = JOB_DONE if error is None else JOB_ERROR
            job.finished_at = time.monotonic()

    def get_job(self, job_id: str) -> dict[str, Any]:
        """Return the current envelope for a previously submitted job.

        Unknown (or already evicted) ids raise 404. Terminal jobs always return
        HTTP 200 with ``status`` ``done``/``error`` so the poller reads the
        outcome from the envelope rather than from the HTTP status code.
        """
        self._evict_expired_jobs()
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise HTTPException(
                    status_code=404,
                    detail="Unknown job id (never submitted or already expired).",
                )
            return job.public()

    def _evict_expired_jobs(self) -> None:
        """Drop terminal jobs whose results have aged past the TTL."""
        now = time.monotonic()
        with self._jobs_lock:
            stale = [
                jid
                for jid, job in self._jobs.items()
                if job.finished_at is not None
                and now - job.finished_at > OCR_JOB_TTL_SECONDS
            ]
            for jid in stale:
                del self._jobs[jid]

    # ── Server-side camera ─────────────────────────────────────────────────

    def camera_start(self, source: str | None = None) -> dict[str, Any]:
        src = source if source is not None else self._camera_source
        try:
            self._camera.start(src)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        self._camera_source = src
        return self.camera_status()

    def camera_stop(self) -> dict[str, Any]:
        self._camera.stop()
        return self.camera_status()

    def camera_status(self) -> dict[str, Any]:
        return {
            "running": self._camera.is_running,
            "source": self._camera.source,
        }

    def camera_mjpeg(self, **kwargs: Any) -> Iterator[bytes]:
        if not self._camera.is_running:
            # Auto-start on the configured default source for convenience.
            self.camera_start(self._camera_source)
        clean = self._clean_kwargs(kwargs)
        return self._camera.mjpeg_generator(
            lambda frame: self.infer_frame(frame, **clean)
        )
