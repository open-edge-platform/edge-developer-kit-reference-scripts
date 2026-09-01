# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Open Model Zoo face recognition: detection -> landmarks -> reidentification.

A direct port of the OMZ ``face_recognition_demo`` (Python) pipeline, which
chains three Intel pre-trained IR models:

* **Face detection** — ``face-detection-retail-0004`` / ``face-detection-adas-0001``
  (SSD, one ``[1, 1, N, 7]`` output of ``[image_id, label, conf, x1, y1, x2, y2]``
  in normalised coordinates, sorted by confidence). Each ROI is expanded by
  ``roi_scale_factor`` (the demo's ``-exp_r_fd``, default 1.15) before it is
  handed to the next stage.
* **Landmarks regression** — ``landmarks-regression-retail-0009`` runs on the
  cropped ROI and returns 5 points (eyes, nose tip, mouth corners) as
  coordinates relative to that crop.
* **Face reidentification** — ``face-reidentification-retail-0095`` embeds the
  landmark-aligned ROI into a 256-d descriptor.

All three are Apache-2.0 Intel models served from storage.openvinotoolkit.org,
and every stage runs on OpenVINO natively from IR.

The demo compares descriptors with ``0.5 * (1 - cosine_similarity)`` and calls a
face known when that distance is below ``-t_id`` (default 0.3); this worker
matches on cosine similarity directly, so the equivalent threshold is
``1 - 2 * 0.3 = 0.4``.
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

import config
from core.align import align_roi_landmarks
from core.download import download_ir
from core.runners import OVRunner
from models.base import BaseFacePipeline, Face

logger = logging.getLogger(__name__)


class OMZFacePipeline(BaseFacePipeline):
    def __init__(self, device: str | None = None, **options: Any) -> None:
        super().__init__(device, **options)
        self.det_threshold = float(options.get("det_threshold", 0.6))
        self.roi_scale_factor = float(options.get("roi_scale_factor", 1.15))
        self.match_threshold = float(options.get("match_threshold", 0.4))
        self._det: OVRunner | None = None
        self._landmarks: OVRunner | None = None
        self._reid: OVRunner | None = None

    # ── Loading ────────────────────────────────────────────────────────────

    def load(self) -> None:
        root = config.MODELS_DIR / "open-model-zoo"
        det_path = download_ir(self.options["det_url"], root)
        lm_path = download_ir(self.options["landmarks_url"], root)
        reid_path = download_ir(self.options["reid_url"], root)

        self._det = OVRunner(det_path, self.device)
        self._landmarks = OVRunner(lm_path, self.device)
        self._reid = OVRunner(reid_path, self.device)
        self.runtime = self._det.runtime

    def _teardown(self) -> None:
        self._det = None
        self._landmarks = None
        self._reid = None

    # ── Detection + landmarks ──────────────────────────────────────────────

    def _detect(self, image: np.ndarray) -> list[Face]:
        assert self._det is not None
        h, w = image.shape[:2]
        # OMZ detectors take BGR 0..255 resized to their static input size —
        # no aspect-ratio padding, exactly like the demo's resize_input().
        _, _, det_h, det_w = self._det.input_shape
        blob = (
            cv2.resize(image, (det_w, det_h))
            .transpose(2, 0, 1)[None]
            .astype(np.float32)
        )
        detections = self._det(blob)[0].reshape(-1, 7)

        faces: list[Face] = []
        for row in detections:
            score = float(row[2])
            # Rows are sorted by decreasing confidence and padded with zeros.
            if score < self.det_threshold:
                break
            box = self._roi(row[3:7], w, h)
            if box is None:
                continue
            faces.append(
                Face(
                    box=box,
                    score=score,
                    landmarks=self._landmark_points(image, box),
                )
            )
        return faces

    def _roi(
        self, corners: np.ndarray, width: int, height: int
    ) -> tuple[float, float, float, float] | None:
        """Normalised [x1, y1, x2, y2] -> expanded, clipped pixel ROI."""
        x1, y1 = float(corners[0]) * width, float(corners[1]) * height
        x2, y2 = float(corners[2]) * width, float(corners[3]) * height
        bw, bh = x2 - x1, y2 - y1
        # -exp_r_fd: grow the box around its centre so the landmark and reid
        # crops see some context beyond the detector's tight box.
        pad = 0.5 * (self.roi_scale_factor - 1.0)
        x1, y1 = x1 - bw * pad, y1 - bh * pad
        bw, bh = bw * self.roi_scale_factor, bh * self.roi_scale_factor

        x1 = min(max(x1, 0.0), float(width))
        y1 = min(max(y1, 0.0), float(height))
        bw = min(bw, float(width) - x1)
        bh = min(bh, float(height) - y1)
        if bw < 1.0 or bh < 1.0:
            return None
        return (x1, y1, bw, bh)

    def _landmark_points(
        self, image: np.ndarray, box: tuple[float, float, float, float]
    ) -> np.ndarray:
        """Run the landmarks regressor on one ROI, in source-image pixels."""
        assert self._landmarks is not None
        crop, (x1, y1) = self._crop(image, box)
        _, _, lm_h, lm_w = self._landmarks.input_shape
        blob = (
            cv2.resize(crop, (lm_w, lm_h))
            .transpose(2, 0, 1)[None]
            .astype(np.float32)
        )
        relative = self._landmarks(blob)[0].reshape(-1, 2).astype(np.float64)
        return relative * [crop.shape[1], crop.shape[0]] + [x1, y1]

    @staticmethod
    def _crop(
        image: np.ndarray, box: tuple[float, float, float, float]
    ) -> tuple[np.ndarray, tuple[int, int]]:
        """Integer-pixel ROI crop plus its top-left origin."""
        h, w = image.shape[:2]
        x, y, bw, bh = box
        x1 = int(np.clip(x, 0, w - 1))
        y1 = int(np.clip(y, 0, h - 1))
        x2 = int(np.clip(round(x + bw), x1 + 1, w))
        y2 = int(np.clip(round(y + bh), y1 + 1, h))
        return image[y1:y2, x1:x2], (x1, y1)

    # ── Recognition ────────────────────────────────────────────────────────

    def _embed(self, image: np.ndarray, face: Face) -> np.ndarray:
        assert self._reid is not None
        crop, (x1, y1) = self._crop(image, face.box)
        relative = (face.landmarks - [x1, y1]) / [crop.shape[1], crop.shape[0]]
        aligned = align_roi_landmarks(crop, relative)
        _, _, reid_h, reid_w = self._reid.input_shape
        blob = (
            cv2.resize(aligned, (reid_w, reid_h))
            .transpose(2, 0, 1)[None]
            .astype(np.float32)
        )
        embedding = self._reid(blob)[0].reshape(-1).astype(np.float32)
        # The demo normalises inside its cosine distance; we do it once here so
        # the worker can match with a plain dot product.
        return embedding / (np.linalg.norm(embedding) + 1e-12)

    def info(self) -> dict[str, Any]:
        data = super().info()
        data["det_threshold"] = self.det_threshold
        data["roi_scale_factor"] = self.roi_scale_factor
        return data
