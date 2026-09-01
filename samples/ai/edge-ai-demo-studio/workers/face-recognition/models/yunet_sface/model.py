# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""YuNet (detection) + SFace (recognition) on OpenVINO.

Both models come from the OpenCV Zoo as ONNX and are read natively by
OpenVINO. OpenCV's ``FaceDetectorYN``/``FaceRecognizerSF`` wrappers are tied to
the OpenCV DNN backend, so the pre/post-processing they normally do is
reimplemented here (ported from OpenCV's C++ implementation):

* YuNet — raw BGR input; per-stride (8/16/32) grids of cls/obj scores, box
  regressions (centre offset + log size) and 5 landmarks; score =
  sqrt(cls * obj); NMS at the end.
* SFace — 112x112 crop aligned to the ArcFace template, RGB 0..255 input,
  128-d embedding compared by cosine similarity (OpenCV threshold 0.363).
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

import config
from core.align import norm_crop
from core.download import download_file
from core.runners import OVRunner
from models.base import BaseFacePipeline, Face

logger = logging.getLogger(__name__)

_STRIDES = (8, 16, 32)


class YuNetSFacePipeline(BaseFacePipeline):
    def __init__(self, device: str | None = None, **options: Any) -> None:
        super().__init__(device, **options)
        self.det_size = int(options.get("det_size", 640))
        self.score_threshold = float(options.get("score_threshold", 0.7))
        self.nms_threshold = float(options.get("nms_threshold", 0.3))
        self.match_threshold = float(options.get("match_threshold", 0.363))
        self._det: OVRunner | None = None
        self._rec: OVRunner | None = None

    # ── Loading ────────────────────────────────────────────────────────────

    def load(self) -> None:
        det_path = download_file(
            self.options["det_url"], config.MODELS_DIR / "yunet" / "yunet.onnx"
        )
        rec_path = download_file(
            self.options["rec_url"], config.MODELS_DIR / "sface" / "sface.onnx"
        )
        # YuNet's ONNX has dynamic spatial dims; fix them once so the decode
        # grids are known and the model compiles a single static shape.
        self._det = OVRunner(
            det_path,
            self.device,
            input_shape=[1, 3, self.det_size, self.det_size],
        )
        self._rec = OVRunner(rec_path, self.device)
        self.runtime = self._det.runtime

    def _teardown(self) -> None:
        self._det = None
        self._rec = None

    # ── Detection ──────────────────────────────────────────────────────────

    def _detect(self, image: np.ndarray) -> list[Face]:
        assert self._det is not None
        h, w = image.shape[:2]
        scale = min(self.det_size / w, self.det_size / h)
        new_w, new_h = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(image, (new_w, new_h))
        padded = np.zeros((self.det_size, self.det_size, 3), dtype=np.uint8)
        padded[:new_h, :new_w] = resized

        blob = padded.transpose(2, 0, 1)[None].astype(np.float32)
        outputs = self._det(blob)
        index = self._det.name_to_index
        named = {name: outputs[i] for name, i in index.items()}

        boxes: list[list[float]] = []
        scores: list[float] = []
        landmarks: list[np.ndarray] = []
        for stride in _STRIDES:
            cls = named[f"cls_{stride}"].reshape(-1)
            obj = named[f"obj_{stride}"].reshape(-1)
            bbox = named[f"bbox_{stride}"].reshape(-1, 4)
            kps = named[f"kps_{stride}"].reshape(-1, 10)

            cols = self.det_size // stride
            score = np.sqrt(np.clip(cls, 0, 1) * np.clip(obj, 0, 1))
            keep = np.where(score >= self.score_threshold)[0]
            if keep.size == 0:
                continue
            rows_idx = keep // cols
            cols_idx = keep % cols
            cx = (cols_idx + bbox[keep, 0]) * stride
            cy = (rows_idx + bbox[keep, 1]) * stride
            bw = np.exp(bbox[keep, 2]) * stride
            bh = np.exp(bbox[keep, 3]) * stride
            x1 = cx - bw / 2
            y1 = cy - bh / 2

            kp = kps[keep].reshape(-1, 5, 2)
            kp[:, :, 0] = (cols_idx[:, None] + kp[:, :, 0]) * stride
            kp[:, :, 1] = (rows_idx[:, None] + kp[:, :, 1]) * stride

            for i in range(keep.size):
                boxes.append([float(x1[i]), float(y1[i]), float(bw[i]), float(bh[i])])
                scores.append(float(score[keep[i]]))
                landmarks.append(kp[i])

        if not boxes:
            return []
        picked = cv2.dnn.NMSBoxes(
            boxes, scores, self.score_threshold, self.nms_threshold
        )
        faces = []
        for idx in np.asarray(picked).flatten():
            x, y, bw, bh = (v / scale for v in boxes[idx])
            faces.append(
                Face(
                    box=(x, y, bw, bh),
                    score=scores[idx],
                    landmarks=landmarks[idx] / scale,
                )
            )
        faces.sort(key=lambda f: f.score, reverse=True)
        return faces

    # ── Recognition ────────────────────────────────────────────────────────

    def _embed(self, image: np.ndarray, face: Face) -> np.ndarray:
        assert self._rec is not None
        aligned = norm_crop(image, face.landmarks)
        # OpenCV FaceRecognizerSF: blobFromImage(aligned, 1.0, 112x112,
        # mean=0, swapRB=True) -> RGB, raw 0..255.
        blob = aligned[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32)
        embedding = self._rec(blob)[0].reshape(-1).astype(np.float32)
        return embedding / (np.linalg.norm(embedding) + 1e-12)
