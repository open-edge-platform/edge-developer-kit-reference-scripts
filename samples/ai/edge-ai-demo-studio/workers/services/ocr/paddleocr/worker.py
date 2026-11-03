# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Orchestrator behind main.py's routes: owns the active model, jobs and camera, and serialises
model swaps."""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Iterator

import numpy as np
from fastapi import HTTPException
from worker_common import CANCELLED, CancelToken, JobCancelled

from config import (
    CAMERA_MIN_INFER_INTERVAL_MS,
    DEFAULT_CAMERA_SOURCE,
    DEFAULT_DEVICE,
    DEFAULT_LANG,
    OCR_JOB_TTL_SECONDS,
)
from core import device as device_mod
from core.camera import ServerCamera
from core.image_io import ImageDecodeError, decode_image
from models import languages, registry
from models.base import BaseOCRModel, ModelAssetUnavailable, TextCallback
from models.result import OCRResult

logger = logging.getLogger(__name__)

# Async job states. A job moves pending -> running -> (done | error), or ends
# cancelled (DELETE /ocr/jobs/{id}) from either of the first two.
JOB_PENDING = "pending"
JOB_RUNNING = "running"
JOB_DONE = "done"
JOB_ERROR = "error"
JOB_CANCELLED = CANCELLED
JOB_FINAL = frozenset({JOB_DONE, JOB_ERROR, JOB_CANCELLED})


@dataclass
class OCRJob:
    """One queued async OCR request (see ``OCRWorker.submit_image_job``)."""

    id: str
    status: str = JOB_PENDING
    result: dict[str, Any] | None = None
    error: str | None = None
    status_code: int = 200
    finished_at: float | None = None  # monotonic time terminal state was reached
    # Processing time of a finished job, read by the app's Live metrics:
    # {"seconds", "items", "started"} — `started` keys the job for the poller.
    perf: dict[str, Any] | None = None
    # Text recognised so far: grows piece by piece for a VL model, filled once for others.
    partial_text: str = ""
    # Set by DELETE /ocr/jobs/{id}; the running pass checks it.
    cancel: CancelToken = field(default_factory=CancelToken)
    # The job's turn on the job thread, dropped if it is cancelled first.
    future: Future | None = None

    def public(self) -> dict[str, Any]:
        """Client-facing envelope returned by the poll endpoint."""
        envelope: dict[str, Any] = {
            "job_id": self.id,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "partial_text": self.partial_text,
        }
        if self.cancel.cancelled:
            envelope["cancel_requested"] = True
        if self.perf is not None:
            envelope["perf"] = self.perf
        return envelope


class OCRWorker:
    def __init__(self) -> None:
        self._device = DEFAULT_DEVICE
        self._lang = DEFAULT_LANG
        self._model: BaseOCRModel | None = None
        self._model_key: str | None = None
        self._swap_lock = threading.Lock()
        self._camera = ServerCamera(CAMERA_MIN_INFER_INTERVAL_MS)
        self._camera_source: str = DEFAULT_CAMERA_SOURCE
        # One job thread serialises inference; results wait in `_jobs` until polled or aged out
        # (OCR_JOB_TTL_SECONDS).
        self._jobs: dict[str, OCRJob] = {}
        self._jobs_lock = threading.Lock()
        self._job_pool = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="ocr-job"
        )

    # Lifecycle

    def startup(
        self,
        default_model: str,
        device: str | None = None,
        autoload: bool = True,
        lang: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> None:
        self._device = device_mod.normalize_device(device or DEFAULT_DEVICE)
        self._lang = languages.resolve(lang or DEFAULT_LANG).key
        logger.info("=" * 60)
        for d in device_mod.get_available_devices():
            logger.info(f"  {d['name']:8s} | {d['full_name']}")
        logger.info(f"  default device requested: {self._device}")
        logger.info("=" * 60)

        if autoload:
            try:
                self.load_model(default_model, self._device, options, lang=self._lang)
            except Exception as exc:
                # Fail the lifespan startup so the process exits rather than running half-broken.
                logger.error(f"Autoload of '{default_model}' failed: {exc}")
                raise

    def shutdown(self) -> None:
        self._camera.stop()
        self._job_pool.shutdown(wait=False, cancel_futures=True)
        # Stop a VL generation in flight, so releasing the model below does
        # not wait for it to finish.
        with self._jobs_lock:
            for job in self._jobs.values():
                job.cancel.cancel()
        if self._model is not None:
            self._model.release()
        logger.info("PaddleOCR worker shut down")

    # Model management

    def load_model(
        self,
        key: str,
        device: str | None = None,
        options: dict[str, Any] | None = None,
        lang: str | None = None,
    ) -> dict[str, Any]:
        try:
            target_device = device_mod.normalize_device(device or self._device)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        # `lang` is a first-class argument but reaches the model as an option,
        # so an explicit options={"lang": ...} still wins.
        overrides = dict(options or {})
        overrides.setdefault("lang", lang or self._lang)
        try:
            target_lang = languages.resolve(overrides["lang"]).key
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            new_model = registry.create_model(key, target_device, overrides)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        # Serialise loads (slow: may download/convert) so two requests don't both build a model.
        with self._swap_lock:
            try:
                new_model.ensure_loaded()
            except ModelAssetUnavailable as exc:
                raise HTTPException(status_code=503, detail=str(exc))
            except Exception as exc:
                logger.error(f"Failed to load '{key}': {exc}", exc_info=True)
                raise HTTPException(
                    status_code=500, detail=f"Failed to load '{key}': {exc}"
                )
            old = self._model
            self._model = new_model
            self._model_key = key
            self._device = target_device
            self._lang = target_lang

        if old is not None and old is not new_model:
            old.release()
        logger.info(
            f"Active model -> {key} on {target_device} (language: {target_lang})"
        )
        return self.get_active()

    def list_models(self) -> dict[str, Any]:
        return {
            "active": self._model_key,
            "device": self._device,
            "language": self._lang,
            "available": registry.list_specs(),
        }

    def list_languages(self) -> dict[str, Any]:
        """Recognition languages selectable per request; ``applies`` is false for VL presets."""
        return {
            "active": self._lang,
            "applies": not (self._model_key or "").startswith("paddleocr-vl"),
            "available": languages.list_specs(),
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

    # Health

    def healthcheck(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "active_model": self._model_key,
            "model_loaded": self._model is not None and self._model.loaded,
            "device": self._device,
            "language": self._lang,
            "camera_running": self._camera.is_running,
            "camera_source": self._camera.source,
        }

    # Inference

    def run_image_bytes(
        self,
        data: bytes,
        on_text: TextCallback | None = None,
        cancel: CancelToken | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return self._infer_image(
            self._decode(data), on_text=on_text, cancel=cancel, **kwargs
        ).to_dict()

    @staticmethod
    def _decode(data: bytes) -> np.ndarray:
        try:
            return decode_image(data)
        except ImageDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    def _infer_image(
        self,
        image: np.ndarray,
        on_text: TextCallback | None = None,
        cancel: CancelToken | None = None,
        **kwargs: Any,
    ) -> OCRResult:
        model = self._require_model()
        try:
            return model.infer(
                image, on_text=on_text, cancel=cancel, **self._clean_kwargs(kwargs)
            )
        except (HTTPException, JobCancelled):
            raise
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except ModelAssetUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc))
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

    # Streamed inference (text as it is generated)

    def stream_image_bytes(
        self, data: bytes, **kwargs: Any
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """OCR one image, yielding ``("delta", {"text"})`` pieces, then ``"done"`` or ``"error"``.

        A bad image or missing model raises before anything is yielded, so the caller can still
        answer with a plain HTTP error. Closing the iterator early stops a VL generation.
        """
        image = self._decode(data)
        self._require_model()
        return self._stream_inference(image, kwargs)

    def _stream_inference(
        self, image: np.ndarray, kwargs: dict[str, Any]
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
        abandoned = CancelToken()

        def on_text(text: str) -> None:
            events.put(("delta", {"text": text}))

        def run() -> None:
            try:
                result = self._infer_image(
                    image, on_text=on_text, cancel=abandoned, **kwargs
                )
                events.put(("done", result.to_dict()))
            except JobCancelled:
                logger.info("Streamed OCR stopped: the client went away")
            except HTTPException as exc:
                events.put(
                    ("error", {"detail": exc.detail, "status": exc.status_code})
                )
            except Exception as exc:  # defensive: always end the stream
                logger.error(f"Streamed OCR failed: {exc}", exc_info=True)
                events.put(("error", {"detail": str(exc), "status": 500}))
            finally:
                events.put(None)

        threading.Thread(target=run, name="ocr-stream", daemon=True).start()
        try:
            while (event := events.get()) is not None:
                yield event
        finally:
            abandoned.cancel()

    # Async (submit + poll) inference

    def submit_image_job(self, data: bytes, **kwargs: Any) -> dict[str, Any]:
        """Queue an image for OCR on the job thread and return its envelope at once."""
        # Fail fast on the common "no model loaded" case so the caller gets a
        # 503 from the submit call rather than having to poll to discover it.
        self._require_model()

        self._evict_expired_jobs()
        job = OCRJob(id=uuid.uuid4().hex)
        with self._jobs_lock:
            self._jobs[job.id] = job
            job.future = self._job_pool.submit(self._run_job, job, data, kwargs)
            return job.public()

    def _run_job(self, job: OCRJob, data: bytes, kwargs: dict[str, Any]) -> None:
        with self._jobs_lock:
            if job.status != JOB_PENDING:  # cancelled while it waited
                return
            job.status = JOB_RUNNING

        def on_text(text: str) -> None:
            with self._jobs_lock:
                job.partial_text += text

        started = time.time()
        try:
            result = self.run_image_bytes(
                data, on_text=on_text, cancel=job.cancel, **kwargs
            )
            self._finish_job(
                job,
                result=result,
                perf={"seconds": time.time() - started, "items": 1, "started": started},
            )
        except JobCancelled:
            logger.info(f"Async job {job.id} cancelled")
            self._finish_job(job)
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
        perf: dict[str, Any] | None = None,
    ) -> None:
        with self._jobs_lock:
            if job.cancel.cancelled:
                # Whatever the pass came to, nobody wants it: a PP-OCR pass
                # is not interrupted, so its result is dropped here.
                result, error, perf, status = None, None, None, JOB_CANCELLED
            else:
                status = JOB_DONE if error is None else JOB_ERROR
            job.result = result
            job.error = error
            job.perf = perf
            job.status_code = status_code
            job.status = status
            job.finished_at = time.monotonic()

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        """Cancel a job and return its envelope.

        A pending job ends ``cancelled`` at once; a running one reports ``cancel_requested`` until
        its pass stops (a VL model at its next token, a PP-OCR pass when done).
        """
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise HTTPException(
                    status_code=404,
                    detail="Unknown job id (never submitted or already expired).",
                )
            if job.status in JOB_FINAL:
                return job.public()
            job.cancel.cancel()
            if job.status == JOB_PENDING:
                job.status = JOB_CANCELLED
                job.finished_at = time.monotonic()
                if job.future is not None:
                    job.future.cancel()
            return job.public()

    def get_job(self, job_id: str) -> dict[str, Any]:
        """Return a job's envelope (404 if unknown or evicted); the outcome is in ``status``."""
        self._evict_expired_jobs()
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise HTTPException(
                    status_code=404,
                    detail="Unknown job id (never submitted or already expired).",
                )
            return job.public()

    def find_job(self, job_id: str) -> dict[str, Any] | None:
        """``get_job`` without the 404: ``None`` once the job is unknown."""
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            return None if job is None else job.public()

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

    # Server-side camera

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
