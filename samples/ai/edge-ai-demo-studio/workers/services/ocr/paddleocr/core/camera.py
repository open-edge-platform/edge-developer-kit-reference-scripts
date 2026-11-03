# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Server-side camera capture and MJPEG streaming.

A reader thread keeps the latest frame; one throttled inference thread, running only while someone
watches, OCRs it and publishes regions that every viewer draws on the latest frame, so video keeps
moving during slow (VL) passes. The most recent viewer's options apply.
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
        # Shared inference: the viewers' count and callable, the thread serving
        # them, and the overlay it last published — all under `_overlay_lock`.
        self._overlay_lock = threading.Lock()
        self._viewers = 0
        self._infer_fn: InferFn | None = None
        self._inferrer: threading.Thread | None = None
        self._regions: list = []
        self._header = ""

    # Lifecycle

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
        with self._overlay_lock:
            self._regions = []
            self._header = ""
        self._source = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def source(self) -> str | int | None:
        return self._source

    # Capture

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

    # Shared inference

    def _attach_viewer(self, infer_fn: InferFn) -> None:
        with self._overlay_lock:
            self._viewers += 1
            self._infer_fn = infer_fn
            if self._inferrer is None:
                self._inferrer = threading.Thread(
                    target=self._infer_loop, name="camera-ocr", daemon=True
                )
                self._inferrer.start()

    def _detach_viewer(self) -> None:
        with self._overlay_lock:
            self._viewers = max(self._viewers - 1, 0)
            if self._viewers == 0:
                self._infer_fn = None

    def _infer_loop(self) -> None:
        """OCR the latest frame over and over while anyone watches."""
        while True:
            with self._overlay_lock:
                # Decided under the lock a viewer attaches under, so a viewer
                # arriving now either sees this thread still serving or starts
                # the next one.
                if not self._running or self._infer_fn is None:
                    self._inferrer = None
                    return
                infer_fn = self._infer_fn

            started = time.time()
            frame = self.latest_frame()
            if frame is None:
                time.sleep(0.03)
                continue
            try:
                result = infer_fn(frame)
                if result is None:
                    regions, header = [], ""
                else:
                    regions = list(result.regions)
                    header = (
                        f"{result.model} | {len(regions)} region(s) "
                        f"| {result.elapsed_ms:.0f} ms"
                    )
            except Exception as exc:  # keep the loop alive on errors
                regions, header = [], f"OCR error: {exc}"
            with self._overlay_lock:
                if self._running:
                    self._regions = regions
                    self._header = header

            elapsed = time.time() - started
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)

    def _overlay(self) -> tuple[list, str]:
        with self._overlay_lock:
            return self._regions, self._header

    # Streaming

    def mjpeg_generator(self, infer_fn: InferFn) -> Iterator[bytes]:
        """Yield ``multipart/x-mixed-replace`` JPEG frames with OCR overlay.

        Joins the shared inference loop with ``infer_fn`` and draws whatever it
        last found, never waiting for a pass to finish.
        """
        boundary = b"--frame\r\n"
        self._attach_viewer(infer_fn)
        try:
            while self._running:
                loop_start = time.time()
                frame = self.latest_frame()
                if frame is None:
                    time.sleep(0.03)
                    continue

                regions, header = self._overlay()
                annotated = draw_regions(frame, regions, header or None)
                jpeg = encode_jpeg(annotated)
                yield boundary + b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"

                # Pace the output so we don't saturate the connection / CPU.
                elapsed = time.time() - loop_start
                if elapsed < self._frame_interval:
                    time.sleep(self._frame_interval - elapsed)
        finally:
            self._detach_viewer()
            logger.info("[CAMERA] MJPEG generator stopped")
