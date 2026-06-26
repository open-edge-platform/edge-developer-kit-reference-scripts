# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Abstract base for all OCR models.

The contract every concrete model follows is deliberately small:

    load()    -> read + compile the OpenVINO model(s)
    warmup()  -> run one throwaway inference so the first real request is fast
    _infer()  -> the actual per-image work, returning an OCRResult

``BaseOCRModel`` wraps these with a re-entrant lock so a model is loaded exactly
once and inference is serialised (OpenVINO infer requests and the VL decoder are
stateful and not safe to call concurrently).
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from typing import Any

import numpy as np

from core.device import normalize_device
from models.result import OCRResult

logger = logging.getLogger(__name__)


class BaseOCRModel(ABC):
    #: Registry key / human-facing identifier. Overridden by subclasses.
    name: str = "base"
    #: One-line description surfaced through the /models endpoint.
    description: str = ""

    def __init__(self, device: str | None = None, **options: Any) -> None:
        self.device = normalize_device(device)
        self.options = options
        self._loaded = False
        # Re-entrant: ensure_loaded() holds the lock while warmup() -> infer()
        # re-acquires it.
        self._lock = threading.RLock()

    # ── Public API ─────────────────────────────────────────────────────────

    @property
    def loaded(self) -> bool:
        return self._loaded

    def ensure_loaded(self) -> None:
        """Load + warm up the model exactly once (idempotent, thread-safe)."""
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            t0 = time.time()
            logger.info(f"[{self.name}] Loading on device={self.device} ...")
            self.load()
            self.warmup()
            self._loaded = True
            logger.info(
                f"[{self.name}] Ready in {(time.time() - t0) * 1000:.0f} ms"
            )

    def infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        """Run OCR on a BGR image, serialising concurrent callers."""
        if not self._loaded:
            self.ensure_loaded()
        t0 = time.time()
        with self._lock:
            result = self._infer(image, **kwargs)
        result.elapsed_ms = (time.time() - t0) * 1000.0
        return result

    def warmup(self) -> None:
        """Default warmup: a single pass over a small blank image."""
        try:
            self._infer(np.zeros((640, 640, 3), dtype=np.uint8))
        except Exception as exc:
            logger.warning(f"[{self.name}] Warmup skipped: {exc}")

    def release(self) -> None:
        """Drop references to compiled models so memory can be reclaimed.

        Acquires the inference lock first so a swap (``load_model`` releases the
        outgoing model while requests may still be inside ``infer``) waits for
        any in-flight ``_infer`` to finish before its handles are torn down.
        """
        with self._lock:
            self._teardown()
            self._loaded = False

    def _teardown(self) -> None:
        """Drop compiled-model references. Called under the lock by release().

        Subclasses override this (not ``release``) so teardown always runs with
        the inference lock held.
        """

    def info(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "device": self.device,
            "loaded": self._loaded,
            "options": {k: str(v) for k, v in self.options.items()},
        }

    # ── To implement ───────────────────────────────────────────────────────

    @abstractmethod
    def load(self) -> None:
        """Read and compile the model(s). Called once under the lock."""

    @abstractmethod
    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        """Run inference on a single BGR image and return an OCRResult."""
