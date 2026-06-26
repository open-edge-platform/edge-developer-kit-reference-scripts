# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import logging
import math
import tarfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import openvino as ov
import pyclipper
import requests
from shapely.geometry import Polygon
from tqdm import tqdm

from config import MODELS_DIR
from core.device import get_core
from models.base import BaseOCRModel
from models.result import OCRRegion, OCRResult

logger = logging.getLogger(__name__)

_REC_BATCH = 6
_DEFAULT_DROP_SCORE = 0.5

# ImageNet normalisation used by PaddleOCR detection models.
_DET_MEAN = np.array([0.485, 0.456, 0.406]).reshape(1, 1, 3).astype("float32")
_DET_STD = np.array([0.229, 0.224, 0.225]).reshape(1, 1, 3).astype("float32")


# ── Asset download / extract ────────────────────────────────────────────────


def _download_file(url: str, dest: Path) -> Path:
    """Stream ``url`` to ``dest`` (skips if already present)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info(f"[download] {url} -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        with open(tmp, "wb") as fh, tqdm(
            total=total, unit="B", unit_scale=True, desc=dest.name, leave=False
        ) as bar:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                fh.write(chunk)
                bar.update(len(chunk))
    tmp.replace(dest)
    return dest


def _ensure_model_file(url: str, cache_dir: Path) -> Path:
    """Return a local model file readable by ``ov.Core.read_model``."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    fname = url.split("/")[-1]

    if fname.endswith(".onnx"):
        return _download_file(url, cache_dir / fname)

    if fname.endswith(".tar"):
        archive = _download_file(url, cache_dir / fname)
        extract_dir = cache_dir / fname[: -len(".tar")]
        if not extract_dir.exists():
            with tarfile.open(archive) as tar:
                base = cache_dir.resolve()
                for member in tar.getmembers():
                    member_path = (cache_dir / member.name).resolve()
                    if not member_path.is_relative_to(base):
                        raise RuntimeError(f"Unsafe path in tar archive: {member.name}")
                tar.extractall(cache_dir)
        # Paddle protobuf (.pdmodel) or the newer PIR (.json) graph file.
        for pattern in (
            "*/inference.pdmodel",
            "*.pdmodel",
            "*/inference.json",
            "*.json",
        ):
            hits = sorted(cache_dir.glob(pattern))
            if hits:
                return hits[0]
        raise FileNotFoundError(f"No inference graph found after extracting {archive}")

    raise ValueError(f"Unsupported model URL (expected .onnx or .tar): {url}")


def _ensure_text_file(url: str, cache_dir: Path) -> Path:
    """Download a plain text asset (e.g. the character dictionary)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    return _download_file(url, cache_dir / url.split("/")[-1])


# ── Detection: preprocessing ────────────────────────────────────────────────


def _det_preprocess(img_bgr: np.ndarray, limit_side_len: int = 960) -> np.ndarray:
    """Resize (longest side <= limit, multiple of 32) + ImageNet-normalise.

    Returns the ``(1, 3, H, W)`` float32 network input. Boxes are rescaled back
    to the original image directly in :func:`_postprocess_det`.
    """
    h, w = img_bgr.shape[:2]
    if max(h, w) > limit_side_len:
        ratio = limit_side_len / (h if h > w else w)
    else:
        ratio = 1.0

    resize_h = max(int(round(h * ratio / 32) * 32), 32)
    resize_w = max(int(round(w * ratio / 32) * 32), 32)

    resized = cv2.resize(img_bgr, (resize_w, resize_h))
    img = resized.astype("float32") / 255.0
    img = (img - _DET_MEAN) / _DET_STD
    return img.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)


# ── Detection: DB post-processing ───────────────────────────────────────────


def _unclip(box: np.ndarray, unclip_ratio: float) -> np.ndarray:
    poly = Polygon(box)
    distance = poly.area * unclip_ratio / poly.length
    offset = pyclipper.PyclipperOffset()
    offset.AddPath(box, pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    return np.array(offset.Execute(distance))


def _get_mini_boxes(contour: np.ndarray) -> tuple[list, float]:
    bounding_box = cv2.minAreaRect(contour)
    points = sorted(list(cv2.boxPoints(bounding_box)), key=lambda x: x[0])

    if points[1][1] > points[0][1]:
        index_1, index_4 = 0, 1
    else:
        index_1, index_4 = 1, 0
    if points[3][1] > points[2][1]:
        index_2, index_3 = 2, 3
    else:
        index_2, index_3 = 3, 2

    box = [points[index_1], points[index_2], points[index_3], points[index_4]]
    return box, min(bounding_box[1])


def _box_score_fast(bitmap: np.ndarray, box: np.ndarray) -> float:
    h, w = bitmap.shape[:2]
    b = box.copy()
    xmin = np.clip(np.floor(b[:, 0].min()).astype(np.int32), 0, w - 1)
    xmax = np.clip(np.ceil(b[:, 0].max()).astype(np.int32), 0, w - 1)
    ymin = np.clip(np.floor(b[:, 1].min()).astype(np.int32), 0, h - 1)
    ymax = np.clip(np.ceil(b[:, 1].max()).astype(np.int32), 0, h - 1)

    mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), dtype=np.uint8)
    b[:, 0] -= xmin
    b[:, 1] -= ymin
    cv2.fillPoly(mask, b.reshape(1, -1, 2).astype(np.int32), 1)
    return cv2.mean(bitmap[ymin : ymax + 1, xmin : xmax + 1], mask)[0]


def _boxes_from_bitmap(
    pred: np.ndarray,
    bitmap: np.ndarray,
    dest_width: int,
    dest_height: int,
    box_thresh: float,
    unclip_ratio: float,
    max_candidates: int = 1000,
) -> np.ndarray:
    height, width = bitmap.shape
    outs = cv2.findContours(
        (bitmap * 255).astype(np.uint8),
        cv2.RETR_LIST,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    contours = outs[0] if len(outs) == 2 else outs[1]

    boxes = []
    for contour in contours[:max_candidates]:
        points, sside = _get_mini_boxes(contour)
        if sside < 3:
            continue
        points = np.array(points)
        if box_thresh > _box_score_fast(pred, points.reshape(-1, 2)):
            continue
        box = _unclip(points, unclip_ratio).reshape(-1, 1, 2)
        box, sside = _get_mini_boxes(box)
        if sside < 5:
            continue
        box = np.array(box)
        box[:, 0] = np.clip(np.round(box[:, 0] / width * dest_width), 0, dest_width)
        box[:, 1] = np.clip(np.round(box[:, 1] / height * dest_height), 0, dest_height)
        boxes.append(box.astype(np.int16))
    return np.array(boxes, dtype=np.int16)


def _order_points_clockwise(pts: np.ndarray) -> np.ndarray:
    x_sorted = pts[np.argsort(pts[:, 0]), :]
    left = x_sorted[:2, :][np.argsort(x_sorted[:2, 1]), :]
    right = x_sorted[2:, :][np.argsort(x_sorted[2:, 1]), :]
    (tl, bl), (tr, br) = left, right
    return np.array([tl, tr, br, bl], dtype="float32")


def _clip(points: np.ndarray, img_h: int, img_w: int) -> np.ndarray:
    points[:, 0] = np.clip(points[:, 0], 0, img_w - 1)
    points[:, 1] = np.clip(points[:, 1], 0, img_h - 1)
    return points


def _postprocess_det(
    pred: np.ndarray,
    src_shape: tuple[int, int],
    bitmap_thresh: float = 0.3,
    box_thresh: float = 0.6,
    unclip_ratio: float = 1.5,
) -> np.ndarray:
    """Turn the raw DB probability map into ordered quadrilateral boxes.

    ``pred`` is the network output ``(1, 1, H, W)``; ``src_shape`` is the
    original image ``(height, width)``.
    """
    prob = pred[0]  # (1, H, W)
    segmentation = prob > bitmap_thresh

    src_h, src_w = src_shape
    boxes = _boxes_from_bitmap(
        prob[0], segmentation[0], src_w, src_h, box_thresh, unclip_ratio
    )

    filtered = []
    for box in boxes:
        box = _order_points_clockwise(box)
        box = _clip(box, src_h, src_w)
        rect_w = int(np.linalg.norm(box[0] - box[1]))
        rect_h = int(np.linalg.norm(box[0] - box[3]))
        if rect_w <= 3 or rect_h <= 3:
            continue
        filtered.append(box)
    return np.array(filtered)


def _sorted_boxes(dt_boxes: np.ndarray) -> list[np.ndarray]:
    """Sort boxes top-to-bottom, then left-to-right."""
    boxes = sorted(dt_boxes, key=lambda b: (b[0][1], b[0][0]))
    for i in range(len(boxes) - 1):
        if (
            abs(boxes[i + 1][0][1] - boxes[i][0][1]) < 10
            and boxes[i + 1][0][0] < boxes[i][0][0]
        ):
            boxes[i], boxes[i + 1] = boxes[i + 1], boxes[i]
    return boxes


# ── Recognition: crop + preprocessing ───────────────────────────────────────


def _get_rotate_crop_image(img: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Perspective-warp a (possibly rotated) quad into an upright crop."""
    points = points.astype(np.float32)
    crop_w = int(
        max(
            np.linalg.norm(points[0] - points[1]),
            np.linalg.norm(points[2] - points[3]),
        )
    )
    crop_h = int(
        max(
            np.linalg.norm(points[0] - points[3]),
            np.linalg.norm(points[1] - points[2]),
        )
    )
    dst = np.float32([[0, 0], [crop_w, 0], [crop_w, crop_h], [0, crop_h]])
    matrix = cv2.getPerspectiveTransform(points, dst)
    out = cv2.warpPerspective(
        img,
        matrix,
        (crop_w, crop_h),
        borderMode=cv2.BORDER_REPLICATE,
        flags=cv2.INTER_CUBIC,
    )
    if out.shape[0] * 1.0 / max(out.shape[1], 1) >= 1.5:
        out = np.rot90(out)
    return out


def _resize_norm_img(
    img: np.ndarray, max_wh_ratio: float, img_height: int
) -> np.ndarray:
    """Resize a crop to fixed height, normalise to [-1, 1], right-pad width."""
    img_w = int(img_height * max_wh_ratio)
    h, w = img.shape[:2]
    ratio = w / float(h)
    resized_w = min(img_w, int(math.ceil(img_height * ratio)))
    resized = cv2.resize(img, (resized_w, img_height)).astype("float32")
    resized = resized.transpose(2, 0, 1) / 255.0
    resized = (resized - 0.5) / 0.5
    padded = np.zeros((3, img_height, img_w), dtype=np.float32)
    padded[:, :, :resized_w] = resized
    return padded


class _CTCLabelDecode:
    """Greedy CTC decoder backed by a character dictionary file."""

    def __init__(self, character_dict_path: str, use_space_char: bool = True):
        chars: list[str] = []
        with open(character_dict_path, "rb") as fh:
            for line in fh.readlines():
                chars.append(line.decode("utf-8").strip("\n").strip("\r\n"))
        if use_space_char:
            chars.append(" ")
        # index 0 is the CTC blank.
        self.character = ["blank"] + chars

    def __call__(self, preds: np.ndarray) -> list[tuple[str, float]]:
        preds_idx = preds.argmax(axis=2)
        preds_prob = preds.max(axis=2)
        results: list[tuple[str, float]] = []
        for idx_seq, prob_seq in zip(preds_idx, preds_prob):
            chars: list[str] = []
            confs: list[float] = []
            prev = -1
            for j, idx in enumerate(idx_seq):
                if idx == 0 or idx == prev:  # blank or repeat
                    prev = idx
                    continue
                prev = idx
                chars.append(self.character[int(idx)])
                confs.append(float(prob_seq[j]))
            text = "".join(chars)
            results.append((text, float(np.mean(confs)) if confs else 0.0))
        return results


# ── Model ───────────────────────────────────────────────────────────────────


class PPOCRModel(BaseOCRModel):
    """Classic two-stage PaddleOCR pipeline (detect + recognise)."""

    def __init__(
        self,
        key: str,
        description: str,
        det_url: str,
        rec_url: str,
        dict_url: str,
        rec_image_height: int = 48,
        det_limit_side_len: int = 960,
        device: str | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(device=device, **extra)
        self.name = key
        self.description = description
        self._det_url = det_url
        self._rec_url = rec_url
        self._dict_url = dict_url
        self.rec_image_height = rec_image_height
        self.det_limit_side_len = det_limit_side_len
        self._cache_dir = MODELS_DIR / "ppocr" / key

        self._det = None
        self._det_out = None
        self._rec = None
        self._rec_out = None
        self._decoder: _CTCLabelDecode | None = None

    # ── Loading ────────────────────────────────────────────────────────────

    def load(self) -> None:
        core = get_core()
        det_path = _ensure_model_file(self._det_url, self._cache_dir)
        rec_path = _ensure_model_file(self._rec_url, self._cache_dir)
        dict_path = _ensure_text_file(self._dict_url, self._cache_dir)

        det_model = core.read_model(det_path)
        self._reshape_input(det_model, ov.PartialShape([-1, 3, -1, -1]))
        self._det = core.compile_model(det_model, self.device)
        self._det_out = self._det.output(0)

        rec_model = core.read_model(rec_path)
        rec_shape = rec_model.input(0).partial_shape
        rec_shape[3] = -1  # dynamic width
        self._reshape_input(rec_model, rec_shape)
        self._rec = core.compile_model(rec_model, self.device)
        self._rec_out = self._rec.output(0)

        self._decoder = _CTCLabelDecode(str(dict_path), use_space_char=True)
        logger.info(
            f"[{self.name}] det={Path(det_path).name} "
            f"rec={Path(rec_path).name} dict={Path(dict_path).name}"
        )

    @staticmethod
    def _reshape_input(model: ov.Model, shape: ov.PartialShape) -> None:
        try:
            model.reshape({model.input(0): shape})
        except Exception as exc:  # static models: keep their fixed shape
            logger.debug(f"reshape skipped: {exc}")

    # ── Inference ──────────────────────────────────────────────────────────

    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        drop_score = float(kwargs.get("drop_score", _DEFAULT_DROP_SCORE))
        src_h, src_w = image.shape[:2]

        net_in = _det_preprocess(image, self.det_limit_side_len)
        pred = self._det([net_in])[self._det_out]
        dt_boxes = _postprocess_det(pred, (src_h, src_w))

        if len(dt_boxes) == 0:
            return OCRResult(
                model=self.name, regions=[], full_text="", extra={"device": self.device}
            )

        dt_boxes = _sorted_boxes(dt_boxes)
        crops = [_get_rotate_crop_image(image, box) for box in dt_boxes]
        rec_res = self._recognise(crops)

        regions: list[OCRRegion] = []
        for box, (text, conf) in zip(dt_boxes, rec_res):
            if not text or conf < drop_score:
                continue
            regions.append(
                OCRRegion(
                    text=text,
                    confidence=conf,
                    box=np.asarray(box, dtype=np.int32).tolist(),
                )
            )

        return OCRResult(
            model=self.name,
            regions=regions,
            full_text="\n".join(r.text for r in regions),
            extra={"device": self.device, "num_detected": len(dt_boxes)},
        )

    def _recognise(self, crops: list[np.ndarray]) -> list[tuple[str, float]]:
        """Batch the crops (sorted by aspect ratio) through recognition."""
        results: list[tuple[str, float]] = [("", 0.0)] * len(crops)
        ratios = [c.shape[1] / max(c.shape[0], 1) for c in crops]
        order = np.argsort(ratios)

        for beg in range(0, len(crops), _REC_BATCH):
            end = min(len(crops), beg + _REC_BATCH)
            max_ratio = max(ratios[order[i]] for i in range(beg, end))
            batch = np.stack(
                [
                    _resize_norm_img(crops[order[i]], max_ratio, self.rec_image_height)
                    for i in range(beg, end)
                ]
            )
            preds = self._rec([batch])[self._rec_out]
            for k, decoded in enumerate(self._decoder(preds)):
                results[order[beg + k]] = decoded
        return results

    def _teardown(self) -> None:
        self._det = self._det_out = None
        self._rec = self._rec_out = None
        self._decoder = None
