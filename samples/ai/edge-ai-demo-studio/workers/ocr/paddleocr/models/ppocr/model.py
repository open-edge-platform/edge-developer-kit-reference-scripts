# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import logging
import math
import tarfile
import time
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

# ── Static-shape ladders (NPU) ──────────────────────────────────────────────
#
# The NPU compiler rejects unbounded dynamic dimensions, so on NPU each model is
# compiled at a fixed shape picked from a ladder and the image is resized to
# fill it *exactly*. Filling rather than letterbox-padding is deliberate: both
# networks carry squeeze-excite blocks whose GlobalAveragePool runs over the
# whole feature map, so padded area leaks into the channel attention and wrecks
# detection (empirically: two words merge into one box at 960x960 with 84% pad).
# A little aspect distortion is harmless by comparison — the dynamic path
# already distorts by rounding to multiples of 32, and recognition re-crops from
# the untouched original image either way.
#
# Detection: the long side is pinned to det_limit_side_len and the short side
# comes from this ladder, so a shape is chosen by aspect ratio alone.
_DET_SHORT_SIDES = (960, 768, 640, 512, 416, 320, 256, 192, 160, 128, 96, 64, 32)
# Recognition: each crop is padded out to the next width up. Keeping the rungs
# tight (multiples of 64) keeps that padding close to what the dynamic path
# already adds when it pads a batch out to its widest crop.
_REC_WIDTHS = (64, 128, 192, 256, 320, 384, 448, 512, 640, 768, 960)

# Compiled NPU blobs are cached on disk, keyed by shape. They are not small (a
# 960x960 detector is ~36 MB, a recogniser ~9.5 MB) and the ladders above allow
# enough combinations to reach a few hundred MB, so the directory is capped and
# trimmed oldest-first. Losing a blob only costs its ~0.5-1s recompile the next
# time that shape comes round.
_OV_CACHE_MAX_BYTES = 512 * 1024 * 1024

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


def _prune_blob_cache(cache_dir: Path, max_bytes: int = _OV_CACHE_MAX_BYTES) -> None:
    """Trim the compiled-blob cache to ``max_bytes``, oldest first.

    Ordering is by mtime, i.e. when a shape was first compiled rather than when
    it was last used — OpenVINO only touches a blob at compile time, and a
    process keeps its compiled models in memory, so there is no read to observe.
    Close enough for a cache whose worst case is a recompile.
    """
    try:
        blobs = [(b, b.stat()) for b in cache_dir.glob("*.blob")]
    except OSError:
        return
    total = sum(st.st_size for _, st in blobs)
    if total <= max_bytes:
        return
    logger.info(
        f"[cache] {cache_dir} at {total / 1e6:.0f} MB, trimming to "
        f"{max_bytes / 1e6:.0f} MB"
    )
    for blob, st in sorted(blobs, key=lambda item: item[1].st_mtime):
        if total <= max_bytes:
            break
        try:
            blob.unlink()
        except OSError:  # already gone, or in use by another worker
            continue
        total -= st.st_size


def _ensure_text_file(url: str, cache_dir: Path) -> Path:
    """Download a plain text asset (e.g. the character dictionary)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    return _download_file(url, cache_dir / url.split("/")[-1])


# ── Detection: preprocessing ────────────────────────────────────────────────


def _det_static_shape(
    img_shape: tuple[int, int], limit_side_len: int
) -> tuple[int, int]:
    """Pick the compiled detection shape ``(H, W)`` closest to this aspect ratio.

    The long side is pinned to ``limit_side_len`` (32-aligned) and the short
    side is the rung of :data:`_DET_SHORT_SIDES` whose ratio is nearest in log
    space, so the error is proportional rather than absolute. Images smaller
    than the limit are scaled up to it; that costs a little inference time but
    keeps the number of distinct compiled shapes small, which matters far more
    on a device where every shape is a separate blob to compile and hold.
    """
    h, w = img_shape
    long_side = max(int(round(limit_side_len / 32) * 32), 32)
    target = min(h, w) / max(h, w)
    short = min(
        (s for s in _DET_SHORT_SIDES if s <= long_side),
        key=lambda s: abs(math.log((s / long_side) / target)),
    )
    return (short, long_side) if w >= h else (long_side, short)


def _det_preprocess(
    img_bgr: np.ndarray,
    limit_side_len: int = 960,
    static_shape: tuple[int, int] | None = None,
) -> np.ndarray:
    """Resize (longest side <= limit, multiple of 32) + ImageNet-normalise.

    Returns the ``(1, 3, H, W)`` float32 network input. Boxes are rescaled back
    to the original image directly in :func:`_postprocess_det`, which only needs
    the source shape — the resize fills the network input completely, in both
    the dynamic and the static (``static_shape``) case, so there is no padding
    offset to undo.
    """
    if static_shape is not None:
        resize_h, resize_w = static_shape
    else:
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
    img: np.ndarray,
    max_wh_ratio: float,
    img_height: int,
    target_w: int | None = None,
) -> np.ndarray:
    """Resize a crop to fixed height, normalise to [-1, 1], right-pad width.

    ``target_w`` pins the padded width exactly, which the static (NPU) path uses
    to pad every crop out to its compiled width rung; otherwise the width
    follows ``max_wh_ratio`` as usual.
    """
    img_w = int(target_w) if target_w is not None else int(img_height * max_wh_ratio)
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
        # Static-shape (NPU) path: the model files, plus models compiled lazily
        # and keyed by input shape. All stay unset on CPU/GPU, where a single
        # dynamic-shape compilation covers every input.
        self._static_paths: tuple[Path, Path] | None = None
        self._compile_cfg: dict[str, Any] = {}
        self._det_cache: dict[tuple[int, ...], tuple[Any, Any]] = {}
        self._rec_cache: dict[tuple[int, ...], tuple[Any, Any]] = {}
        self._decoder: _CTCLabelDecode | None = None

    # ── Loading ────────────────────────────────────────────────────────────

    def load(self) -> None:
        core = get_core()
        det_path = _ensure_model_file(self._det_url, self._cache_dir)
        rec_path = _ensure_model_file(self._rec_url, self._cache_dir)
        dict_path = _ensure_text_file(self._dict_url, self._cache_dir)
        self._decoder = _CTCLabelDecode(str(dict_path), use_space_char=True)

        if self._needs_static_shapes():
            # Nothing is compiled up front: an image touches exactly one
            # detection shape and only the few recognition widths its crops
            # need, so walking the whole ladder eagerly would throw most of the
            # work away. Blobs land in CACHE_DIR, so each shape pays for its
            # (slow) NPU compilation once per machine rather than once per run.
            self._static_paths = (det_path, rec_path)
            self._compile_cfg = {"CACHE_DIR": str(self._cache_dir / "ov_cache")}
            logger.info(
                f"[{self.name}] {self.device} needs static shapes: detection at "
                f"a {self.det_limit_side_len}px long side, recognition widths "
                f"{list(_REC_WIDTHS)}; compiled on first use."
            )
        else:
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

        logger.info(
            f"[{self.name}] det={Path(det_path).name} "
            f"rec={Path(rec_path).name} dict={Path(dict_path).name}"
        )

    def _needs_static_shapes(self) -> bool:
        """True when the target device rejects unbounded dynamic dimensions.

        The NPU compiler refuses any model with an unbounded dimension ("Upper
        bounds are not specified for node ..."), so on NPU both stages run at
        fixed shapes drawn from a ladder. CPU and GPU keep the dynamic shapes,
        which suit them better anyway: nothing is resized to a rung or padded
        out to one.
        """
        return self.device.split(".")[0].upper() == "NPU"

    def _compiled(
        self,
        path: Path,
        shape: tuple[int, ...],
        cache: dict[tuple[int, ...], tuple[Any, Any]],
    ) -> tuple[Any, Any]:
        """Compile ``path`` at a fixed ``shape``, memoised in ``cache``.

        Called from the inference path, which the base class already serialises
        behind the model lock, so the cache needs no extra guarding.
        """
        hit = cache.get(shape)
        if hit is None:
            t0 = time.time()
            core = get_core()
            model = core.read_model(path)
            self._reshape_input(model, ov.PartialShape(list(shape)), strict=True)
            compiled = core.compile_model(model, self.device, self._compile_cfg)
            hit = cache[shape] = (compiled, compiled.output(0))
            _prune_blob_cache(Path(self._compile_cfg["CACHE_DIR"]))
            logger.info(
                f"[{self.name}] compiled {Path(path).stem} at {list(shape)} on "
                f"{self.device} in {(time.time() - t0) * 1000:.0f} ms"
            )
        return hit

    @staticmethod
    def _reshape_input(
        model: ov.Model, shape: ov.PartialShape, strict: bool = False
    ) -> None:
        try:
            model.reshape({model.input(0): shape})
        except Exception as exc:  # static models: keep their fixed shape
            if strict:
                # Quietly keeping the original shape would hand the NPU a model
                # it cannot compile, surfacing as an opaque error much later.
                raise RuntimeError(
                    f"Could not reshape model input to {shape}, the static "
                    f"shape this device requires: {exc}"
                ) from exc
            logger.debug(f"reshape skipped: {exc}")

    # ── Inference ──────────────────────────────────────────────────────────

    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        drop_score = float(kwargs.get("drop_score", _DEFAULT_DROP_SCORE))
        src_h, src_w = image.shape[:2]

        dt_boxes = self._detect(image)

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

    def _detect(self, image: np.ndarray) -> np.ndarray:
        """Detect text boxes, in original-image coordinates."""
        src_h, src_w = image.shape[:2]
        if self._static_paths is None:
            net_in = _det_preprocess(image, self.det_limit_side_len)
            det, det_out = self._det, self._det_out
        else:
            shape = _det_static_shape((src_h, src_w), self.det_limit_side_len)
            net_in = _det_preprocess(
                image, self.det_limit_side_len, static_shape=shape
            )
            det, det_out = self._compiled(
                self._static_paths[0], (1, 3, *shape), self._det_cache
            )
        return _postprocess_det(det([net_in])[det_out], (src_h, src_w))

    def _recognise(self, crops: list[np.ndarray]) -> list[tuple[str, float]]:
        """Batch the crops (sorted by aspect ratio) through recognition.

        The static (NPU) path runs them one at a time instead — see
        :meth:`_recognise_one`.
        """
        ratios = [c.shape[1] / max(c.shape[0], 1) for c in crops]
        if self._static_paths is not None:
            # Sorting by aspect ratio only exists to hold a batch's padding
            # down, and this path does not batch, so take them in order.
            return [self._recognise_one(c, r) for c, r in zip(crops, ratios)]

        results: list[tuple[str, float]] = [("", 0.0)] * len(crops)
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

    def _recognise_one(self, crop: np.ndarray, ratio: float) -> tuple[str, float]:
        """Recognise a single crop at the narrowest compiled width that fits.

        The static path deliberately runs one crop at a time instead of filling
        a fixed ``_REC_BATCH``, which would mean padding the tail batch with
        blank rows. On NPU batch 1 measured level with batch 6 at the narrow
        widths and ~2.4x faster at the widest, while compiling in a fraction of
        the time and caching much smaller blobs. Going one at a time also picks
        the width per crop rather than per batch, so a batch's widest crop no
        longer inflates the padding on all the others.
        """
        needed = int(math.ceil(self.rec_image_height * ratio))
        width = next((w for w in _REC_WIDTHS if w >= needed), _REC_WIDTHS[-1])
        rec, rec_out = self._compiled(
            self._static_paths[1],
            (1, 3, self.rec_image_height, width),
            self._rec_cache,
        )
        net_in = _resize_norm_img(
            crop, ratio, self.rec_image_height, target_w=width
        )[np.newaxis, ...]
        return self._decoder(rec([net_in])[rec_out])[0]

    def _teardown(self) -> None:
        self._det = self._det_out = None
        self._rec = self._rec_out = None
        self._static_paths = None
        self._det_cache = {}
        self._rec_cache = {}
        self._decoder = None
