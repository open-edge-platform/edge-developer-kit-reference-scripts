# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Abstract base for OCR models: subclasses implement ``load()`` and ``_infer()``.

Loading and inference are serialised under a re-entrant lock (OpenVINO infer requests and the VL
decoder are stateful). A ``streams_text`` model passes text pieces to ``on_text`` and stops at
its next token when cancelled; other models report their text once and are not interrupted.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from typing import Any, Callable

import numpy as np
from worker_common import CancelToken

from core.device import normalize_device
from models.result import OCRResult

logger = logging.getLogger(__name__)

#: Receives each piece of recognised text as the model produces it.
TextCallback = Callable[[str], None]


class ModelAssetUnavailable(RuntimeError):
    """A model file isn't on disk and couldn't be downloaded; going online once fixes it."""


class BaseOCRModel(ABC):
    #: Registry key.
    name: str = "base"
    #: One-line description surfaced through the /models endpoint.
    description: str = ""
    #: Whether ``_infer`` accepts ``on_text`` and calls it as text is generated,
    #: and accepts ``cancel`` and checks it at every token.
    streams_text: bool = False

    def __init__(self, device: str | None = None, **options: Any) -> None:
        self.device = normalize_device(device)
        self.options = options
        self._loaded = False
        # Re-entrant: ensure_loaded() holds the lock while warmup() -> infer()
        # re-acquires it.
        self._lock = threading.RLock()

    # Public API

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

    def infer(
        self,
        image: np.ndarray,
        on_text: TextCallback | None = None,
        cancel: CancelToken | None = None,
        **kwargs: Any,
    ) -> OCRResult:
        """Run OCR on a BGR image, serialising concurrent callers.

        ``on_text`` gets the text piece by piece from a ``streams_text`` model, else all at once;
        the result stays authoritative. Once ``cancel`` is cancelled this raises ``JobCancelled``
        before the pass, at the next streamed token, or after the pass.
        """
        if not self._loaded:
            self.ensure_loaded()
        streaming = on_text is not None and self.streams_text
        if streaming:
            kwargs["on_text"] = on_text
        if cancel is not None and self.streams_text:
            kwargs["cancel"] = cancel
        t0 = time.time()
        with self._lock:
            if cancel is not None:
                cancel.check()
            result = self._infer(image, **kwargs)
        if cancel is not None:
            cancel.check()
        result.elapsed_ms = (time.time() - t0) * 1000.0
        if on_text is not None and not streaming and result.full_text:
            on_text(result.full_text)
        return result

    def warmup(self) -> None:
        """Default warmup: a single pass over a small blank image."""
        try:
            self._infer(np.zeros((640, 640, 3), dtype=np.uint8))
        except Exception as exc:
            logger.warning(f"[{self.name}] Warmup skipped: {exc}")

    def release(self) -> None:
        """Drop compiled models, waiting for any in-flight ``_infer`` (a model swap may race it)."""
        with self._lock:
            self._teardown()
            self._loaded = False

    def _teardown(self) -> None:
        """Drop compiled-model references; override this, not ``release``, to run under the lock."""

    def info(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "device": self.device,
            "loaded": self._loaded,
            "options": {k: str(v) for k, v in self.options.items()},
        }

    # To implement

    @abstractmethod
    def load(self) -> None:
        """Read and compile the model(s). Called once under the lock."""

    @abstractmethod
    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        """Run inference on a single BGR image and return an OCRResult."""
