# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Abstract base for all face-recognition pipelines.

A pipeline bundles a face *detector* and a face *embedder*:

    load()     -> download + compile the model pair
    _detect()  -> find faces (box, score, 5 landmarks) in a BGR image
    _embed()   -> L2-normalised embedding for one aligned face

``BaseFacePipeline`` wraps these with a re-entrant lock so a pipeline is loaded
exactly once and inference is serialised (OpenVINO infer requests are stateful
and not safe to call concurrently).
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from core.device import normalize_device

logger = logging.getLogger(__name__)


@dataclass
class Face:
    """One detected face. Coordinates are pixels of the source image."""

    box: tuple[float, float, float, float]  # x, y, w, h
    score: float
    landmarks: np.ndarray  # (5, 2) — eyes, nose, mouth corners
    embedding: np.ndarray | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "box": [round(float(v), 2) for v in self.box],
            "score": round(float(self.score), 4),
            "landmarks": [
                [round(float(x), 2), round(float(y), 2)] for x, y in self.landmarks
            ],
        }


@dataclass
class DetectionTimings:
    detect_ms: float = 0.0
    embed_ms: float = 0.0
    faces: list[Face] = field(default_factory=list)


class BaseFacePipeline(ABC):
    #: Registry key / human-facing identifier. Set by the registry factory.
    key: str = "base"
    description: str = ""
    #: Cosine-similarity decision threshold (embeddings are L2-normalised).
    match_threshold: float = 0.5
    #: Runtime actually used after load(), e.g. "openvino:GPU" / "pytorch:xpu".
    runtime: str = ""

    def __init__(self, device: str | None = None, **options: Any) -> None:
        self.device = normalize_device(device)
        self.options = options
        self._loaded = False
        # Re-entrant: ensure_loaded() holds the lock while warmup() re-acquires.
        self._lock = threading.RLock()

    # ── Public API ─────────────────────────────────────────────────────────

    @property
    def loaded(self) -> bool:
        return self._loaded

    def ensure_loaded(self) -> None:
        """Load + warm up the pipeline exactly once (idempotent, thread-safe)."""
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            t0 = time.time()
            logger.info(f"[{self.key}] Loading on device={self.device} ...")
            self.load()
            self.warmup()
            self._loaded = True
            logger.info(
                f"[{self.key}] Ready ({self.runtime}) in "
                f"{(time.time() - t0) * 1000:.0f} ms"
            )

    def detect(self, image: np.ndarray) -> DetectionTimings:
        """Detect faces and compute an embedding for each one."""
        if not self._loaded:
            self.ensure_loaded()
        with self._lock:
            t0 = time.time()
            faces = self._detect(image)
            t1 = time.time()
            for face in faces:
                face.embedding = self._embed(image, face)
            t2 = time.time()
        return DetectionTimings(
            detect_ms=(t1 - t0) * 1000.0,
            embed_ms=(t2 - t1) * 1000.0,
            faces=faces,
        )

    def embed_largest_face(self, image: np.ndarray) -> Face | None:
        """Detect + embed only the largest face (used for gallery enrollment)."""
        if not self._loaded:
            self.ensure_loaded()
        with self._lock:
            faces = self._detect(image)
            if not faces:
                return None
            face = max(faces, key=lambda f: f.box[2] * f.box[3])
            face.embedding = self._embed(image, face)
            return face

    def warmup(self) -> None:
        """Default warmup: a single pass over a small blank image."""
        try:
            self._detect(np.zeros((320, 320, 3), dtype=np.uint8))
        except Exception as exc:
            logger.warning(f"[{self.key}] Warmup skipped: {exc}")

    def release(self) -> None:
        """Drop compiled-model references so memory can be reclaimed."""
        with self._lock:
            self._teardown()
            self._loaded = False

    def _teardown(self) -> None:
        """Subclasses override this (not ``release``) to drop model handles."""

    def info(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "description": self.description,
            "device": self.device,
            "runtime": self.runtime,
            "loaded": self._loaded,
            "match_threshold": self.match_threshold,
        }

    # ── To implement ───────────────────────────────────────────────────────

    @abstractmethod
    def load(self) -> None:
        """Download + compile the detector and embedder. Called once."""

    @abstractmethod
    def _detect(self, image: np.ndarray) -> list[Face]:
        """Detect faces in a BGR image."""

    @abstractmethod
    def _embed(self, image: np.ndarray, face: Face) -> np.ndarray:
        """Return the L2-normalised embedding for one detected face."""
