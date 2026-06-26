# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Server-side camera capture and MJPEG streaming.

A background thread keeps the most recent frame from an OpenCV capture source
(a local webcam index, a video file, or an RTSP/HTTP URL). The MJPEG generator
runs OCR on the latest frame at a throttled rate and yields annotated JPEGs, so
the capture rate is decoupled from the (slower) inference rate.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Iterator

import cv2
import numpy as np

from core.annotate import draw_regions
from core.image_io import encode_jpeg

logger = logging.getLogger(__name__)

# Inference callable: BGR frame -> OCRResult (or None if no model is ready).
InferFn = Callable[[np.ndarray], object]


def _parse_source(source: str | int) -> str | int:
    """Turn ``"0"`` into the int ``0`` while leaving paths/URLs as strings."""
    if isinstance(source, int):
        return source
    s = str(source).strip()
    return int(s) if s.isdigit() else s


class ServerCamera:
    """Owns a single server-side capture device and its reader thread."""

    def __init__(
        self, min_infer_interval_ms: int = 300, stream_fps: int = 20
    ) -> None:
        self._min_interval = max(min_infer_interval_ms, 0) / 1000.0
        self._frame_interval = 1.0 / max(stream_fps, 1)
        self._cap: cv2.VideoCapture | None = None
        self._source: str | int | None = None
        self._latest: np.ndarray | None = None
        self._lock = threading.Lock()
        self._reader: threading.Thread | None = None
        self._running = False

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self, source: str | int) -> None:
        self.stop()
        parsed = _parse_source(source)
        cap = cv2.VideoCapture(parsed)
        if not cap.isOpened():
            cap.release()
            raise RuntimeError(f"Could not open camera source '{source}'")

        self._cap = cap
        self._source = source
        self._running = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        logger.info(f"[CAMERA] Started capture from source '{source}'")

    def stop(self) -> None:
        self._running = False
        if self._reader is not None:
            self._reader.join(timeout=2.0)
            self._reader = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        with self._lock:
            self._latest = None
        self._source = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def source(self) -> str | int | None:
        return self._source

    # ── Capture ────────────────────────────────────────────────────────────

    def _read_loop(self) -> None:
        assert self._cap is not None
        while self._running:
            ok, frame = self._cap.read()
            if not ok:
                # File ended or device hiccup; back off briefly.
                time.sleep(0.02)
                continue
            with self._lock:
                self._latest = frame

    def latest_frame(self) -> np.ndarray | None:
        with self._lock:
            return None if self._latest is None else self._latest.copy()

    # ── Streaming ──────────────────────────────────────────────────────────

    def mjpeg_generator(self, infer_fn: InferFn) -> Iterator[bytes]:
        """Yield ``multipart/x-mixed-replace`` JPEG frames with OCR overlay."""
        boundary = b"--frame\r\n"
        last_infer = 0.0
        last_regions: list = []
        header = ""

        while self._running:
            loop_start = time.time()
            frame = self.latest_frame()
            if frame is None:
                time.sleep(0.03)
                continue

            now = loop_start
            if now - last_infer >= self._min_interval:
                last_infer = now
                try:
                    result = infer_fn(frame)
                    if result is not None:
                        last_regions = list(result.regions)
                        header = (
                            f"{result.model} | {len(last_regions)} region(s) "
                            f"| {result.elapsed_ms:.0f} ms"
                        )
                except Exception as exc:  # keep the stream alive on errors
                    header = f"OCR error: {exc}"
                    last_regions = []

            annotated = draw_regions(frame, last_regions, header or None)
            jpeg = encode_jpeg(annotated)
            yield boundary + b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"

            # Pace the output so we don't saturate the connection / CPU.
            elapsed = time.time() - loop_start
            if elapsed < self._frame_interval:
                time.sleep(self._frame_interval - elapsed)

        logger.info("[CAMERA] MJPEG generator stopped")
