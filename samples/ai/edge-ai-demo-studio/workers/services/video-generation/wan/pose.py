# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Pose maps for pose-to-video: VACE's own pose annotator, run with OpenVINO.

VACE learned pose control from videos drawn by its ``PoseBodyFaceVideoAnnotator``: YOLOX-L finds the
people, DWPose-L places 133 COCO-WholeBody keypoints on each, and the body (OpenPose's 18 points) and
the face (68 points) are drawn OpenPose-style on black at about 1024 px. This does the same with the
same two ONNX models (``yzd-v/DWPose``, Apache-2.0), written here from VACE's annotator (Apache-2.0)
so the maps match the ones the model was trained on: the colours, line widths and drawing size all
show in what it generates.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

WEIGHTS_REPO = "yzd-v/DWPose"
DETECTOR = "yolox_l.onnx"
POSE_MODEL = "dw-ll_ucoco_384.onnx"

#: The shorter side people are found and drawn at (VACE's ``RESIZE_SIZE``).
DRAW_SIZE = 1024
DETECTOR_SIZE = 640
#: A keypoint is drawn when its score is above this (OpenPose's and VACE's threshold).
VISIBLE = 0.3

# OpenPose's 18 body points from COCO-WholeBody's first 17 plus a neck between the shoulders.
_MMPOSE = [17, 6, 8, 10, 7, 9, 12, 14, 16, 13, 15, 2, 1, 4, 3]
_OPENPOSE = [1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17]
# OpenPose's limbs (1-based) and colours, in the order they are drawn.
_LIMBS = [
    (2, 3), (2, 6), (3, 4), (4, 5), (6, 7), (7, 8), (2, 9), (9, 10), (10, 11),
    (2, 12), (12, 13), (13, 14), (2, 1), (1, 15), (15, 17), (1, 16), (16, 18),
]  # fmt: skip
_COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0),
    (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255),
    (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85),
]  # fmt: skip


def draw_size(width: int, height: int) -> tuple[int, int]:
    """The size a ``width`` x ``height`` frame is drawn at: shorter side 1024, both multiples of 64."""
    k = DRAW_SIZE / min(width, height)
    return int(round(width * k / 64)) * 64, int(round(height * k / 64)) * 64


def _nms(boxes: np.ndarray, scores: np.ndarray, threshold: float) -> list[int]:
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        w = np.maximum(0.0, np.minimum(x2[i], x2[order[1:]]) - np.maximum(x1[i], x1[order[1:]]) + 1)
        h = np.maximum(0.0, np.minimum(y2[i], y2[order[1:]]) - np.maximum(y1[i], y1[order[1:]]) + 1)
        overlap = w * h / (areas[i] + areas[order[1:]] - w * h)
        order = order[1:][overlap <= threshold]
    return keep


class PoseExtractor:
    def __init__(self, model_dir: Path, device: str = "CPU"):
        from worker_common import openvino_compile_config, openvino_core

        core = openvino_core()
        config = openvino_compile_config(device, model_dir=model_dir)
        self.detector = core.compile_model(core.read_model(model_dir / DETECTOR), device, config)
        pose = core.read_model(model_dir / POSE_MODEL)
        self.pose_size = tuple(pose.input(0).get_partial_shape().get_min_shape()[2:][::-1])  # (w, h)
        pose.reshape({pose.input(0): [1, 3, self.pose_size[1], self.pose_size[0]]})
        self.pose = core.compile_model(pose, device, config)
        grids, strides = [], []
        for stride in (8, 16, 32):
            n = DETECTOR_SIZE // stride
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), stride))
        self._grid = np.concatenate(grids).astype(np.float32)
        self._stride = np.concatenate(strides).astype(np.float32)

    def _people(self, bgr: np.ndarray) -> np.ndarray:
        """Person boxes ``[N, 4]`` (x1, y1, x2, y2): YOLOX on a 640 letterbox, NMS 0.45, score 0.3."""
        h, w = bgr.shape[:2]
        r = min(DETECTOR_SIZE / h, DETECTOR_SIZE / w)
        padded = np.full((DETECTOR_SIZE, DETECTOR_SIZE, 3), 114, np.uint8)
        padded[: int(h * r), : int(w * r)] = cv2.resize(bgr, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
        out = self.detector(padded.transpose(2, 0, 1)[None].astype(np.float32))[0][0]
        xy = (out[:, :2] + self._grid) * self._stride
        wh = np.exp(out[:, 2:4]) * self._stride
        boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1) / r
        scores = out[:, 4] * out[:, 5]  # objectness x person
        candidates = scores > 0.1
        boxes, scores = boxes[candidates], scores[candidates]
        keep = [i for i in _nms(boxes, scores, 0.45) if scores[i] > 0.3]
        return boxes[keep]

    def _keypoints(self, bgr: np.ndarray, boxes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """DWPose on each box padded 1.25x: ``[N, 133, 2]`` pixel keypoints and ``[N, 133]`` scores."""
        if len(boxes) == 0:
            boxes = np.array([[0, 0, bgr.shape[1], bgr.shape[0]]], np.float32)
        w, h = self.pose_size
        mean = np.array([123.675, 116.28, 103.53])
        std = np.array([58.395, 57.12, 57.375])
        points, scores = [], []
        for x1, y1, x2, y2 in boxes:
            center = np.array([x1 + x2, y1 + y2]) * 0.5
            scale = np.array([x2 - x1, y2 - y1]) * 1.25
            scale = np.array([scale[0], scale[0] / (w / h)]) if scale[0] > scale[1] * w / h else np.array([scale[1] * w / h, scale[1]])
            k = w / scale[0]
            warp = np.array([[k, 0, w / 2 - k * center[0]], [0, k, h / 2 - k * center[1]]], np.float32)
            crop = cv2.warpAffine(bgr, warp, (w, h), flags=cv2.INTER_LINEAR)
            x = ((crop - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
            simcc_x, simcc_y = (np.array(o) for o in self.pose(x).values())
            locs = np.stack([simcc_x[0].argmax(1), simcc_y[0].argmax(1)], -1).astype(np.float32) / 2.0
            vals = np.minimum(simcc_x[0].max(1), simcc_y[0].max(1))
            locs[vals <= 0] = -1
            points.append(locs / np.array([w, h]) * scale + center - scale / 2)
            scores.append(vals)
        return np.array(points), np.array(scores)

    def draw(self, bgr: np.ndarray) -> np.ndarray:
        """The pose map of one frame, RGB at the frame's size."""
        H, W = bgr.shape[:2]
        points, scores = self._keypoints(bgr, self._people(bgr))
        info = np.concatenate([points, scores[..., None]], -1)
        neck = info[:, [5, 6]].mean(1)
        neck[:, 2] = np.logical_and(info[:, 5, 2] > VISIBLE, info[:, 6, 2] > VISIBLE)
        info = np.insert(info, 17, neck, axis=1)
        info[:, _OPENPOSE] = info[:, _MMPOSE]
        points, scores = info[..., :2].copy(), info[..., 2]
        points[scores < VISIBLE] = -1

        canvas = np.zeros((H, W, 3), np.uint8)
        for person, score in zip(points, scores):
            for i, (a, b) in enumerate(_LIMBS):
                if score[a - 1] <= VISIBLE or score[b - 1] <= VISIBLE:
                    continue
                (x0, y0), (x1, y1) = person[a - 1], person[b - 1]
                length = math.hypot(x0 - x1, y0 - y1)
                angle = math.degrees(math.atan2(y0 - y1, x0 - x1))
                polygon = cv2.ellipse2Poly(
                    (int((x0 + x1) / 2), int((y0 + y1) / 2)), (int(length / 2), 4), int(angle), 0, 360, 1
                )
                cv2.fillConvexPoly(canvas, polygon, _COLORS[i])
        canvas = (canvas * 0.6).astype(np.uint8)
        for person, score in zip(points, scores):
            for i in range(18):
                if score[i] > VISIBLE:
                    cv2.circle(canvas, (int(person[i][0]), int(person[i][1])), 4, _COLORS[i], thickness=-1)
            for x, y in person[24:92]:
                if x > 0.01 * W and y > 0.01 * H:
                    cv2.circle(canvas, (int(x), int(y)), 3, (255, 255, 255), thickness=-1)
        # VACE draws as OpenCV does (BGR) and hands the canvas on as RGB: its colours are swapped.
        return canvas[..., ::-1]

    def __call__(
        self,
        frames: np.ndarray,
        width: int,
        height: int,
        progress: Callable[[int, int], None] = lambda done, total: None,
        should_stop: Callable[[], bool] = lambda: False,
    ) -> np.ndarray:
        """``frames``: RGB ``[T, h, w, 3]`` at ``draw_size``. Pose maps ``[T, height, width, 3]``."""
        maps = np.empty((len(frames), height, width, 3), np.uint8)
        for i, frame in enumerate(frames):
            if should_stop():
                break
            drawn = self.draw(np.ascontiguousarray(frame[..., ::-1]))
            maps[i] = cv2.resize(drawn, (width, height), interpolation=cv2.INTER_AREA)
            progress(i + 1, len(frames))
        return maps


def read_video(
    path: Path, ffmpeg: str, fps: int, width: int, height: int, max_frames: int
) -> np.ndarray:
    """RGB frames of a video at ``fps``, scaled to fit inside ``width`` x ``height`` and centred on
    black. Never cropped: covering a landscape frame with a portrait video kept only its middle (the
    hips and knees of someone dancing), and VACE then made a video of legs. Pose maps are drawn on
    black, so the bars are simply where nobody is."""
    import subprocess  # nosec B404 - runs the bundled ffmpeg with a fixed argument list

    scale = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    )
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-vf", f"fps={fps},{scale}", "-frames:v", str(max_frames),
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]  # fmt: skip
    result = subprocess.run(command, capture_output=True)  # nosec B603 - fixed argument list, no shell
    if result.returncode != 0:
        raise ValueError(f"Could not read the video: {result.stderr.decode(errors='replace')[-300:]}")
    count = len(result.stdout) // (width * height * 3)
    if count == 0:
        raise ValueError("The video has no frames")
    return np.frombuffer(result.stdout[: count * width * height * 3], np.uint8).reshape(count, height, width, 3)


def missing_weights(model_dir: Path) -> Optional[str]:
    for name in (DETECTOR, POSE_MODEL):
        if not (model_dir / name).is_file():
            return name
    return None
