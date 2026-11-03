# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import logging
import math
import os
import shutil
import tarfile
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import numpy as np
import openvino as ov
import pyclipper
from model_downloader import ModelDownloadError, fetch_url
from shapely.geometry import Polygon
from worker_common import openvino_pinned_cpu_config, shared_model_lock

from config import MODELS_DIR
from core.device import get_core
from models import languages
from models.base import BaseOCRModel, ModelAssetUnavailable
from models.result import OCRRegion, OCRResult

logger = logging.getLogger(__name__)

_REC_BATCH = 6
_DEFAULT_DROP_SCORE = 0.5

# Extra language recognisers kept compiled beside the preset's own (pinned, not counted). ~10 MB
# each: enough to compare a few languages without accumulating every one ever requested.
_MAX_CACHED_LANGUAGES = 3

# Static-shape ladders (NPU): the NPU rejects unbounded dynamic dims, so each model compiles at a
# ladder shape and the image is resized to fill it exactly. Not letterboxed: squeeze-excite
# GlobalAveragePool sees the padding and wrecks detection (two words in one box at 84% pad).
#
# Detection: the long side is pinned to det_limit_side_len and the short side
# comes from this ladder, so a shape is chosen by aspect ratio alone.
_DET_SHORT_SIDES = (960, 768, 640, 512, 416, 320, 256, 192, 160, 128, 96, 64, 32)
# Recognition: each crop is padded to the next width up; tight rungs keep that padding close to
# the dynamic path's.
_REC_WIDTHS = (64, 128, 192, 256, 320, 384, 448, 512, 640, 768, 960)

# Cap on the on-disk NPU blob cache (960x960 detector ~36 MB, recogniser ~9.5 MB); trimmed
# oldest-first, and a lost blob only costs a ~0.5-1 s recompile.
_OV_CACHE_MAX_BYTES = 512 * 1024 * 1024

# ImageNet normalisation used by PaddleOCR detection models.
_DET_MEAN = np.array([0.485, 0.456, 0.406]).reshape(1, 1, 3).astype("float32")
_DET_STD = np.array([0.229, 0.224, 0.225]).reshape(1, 1, 3).astype("float32")


# Asset download / extract


def _download_file(url: str, dest: Path) -> Path:
    """Fetch ``url`` to ``dest`` unless present.

    A failure raises :class:`ModelAssetUnavailable`, so the API answers 503 with a remedy.
    """
    try:
        return fetch_url(url, dest)
    except ModelDownloadError as exc:
        host = urlparse(url).netloc
        raise ModelAssetUnavailable(
            f"{dest.name} has not been downloaded yet and {host} could not be "
            f"reached ({exc}). Connect to the internet once so it can be "
            f"fetched; after that it is served from {dest.parent} and works "
            f"offline."
        ) from exc


def _ensure_model_file(url: str, cache_dir: Path) -> Path:
    """Return a local model file readable by ``ov.Core.read_model``."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    fname = url.split("/")[-1]

    if fname.endswith(".onnx"):
        return _download_file(url, cache_dir / fname)

    if fname.endswith(".tar"):
        archive = _download_file(url, cache_dir / fname)
        # Extract into the archive's own dir and search only there: every archive in a cache dir
        # contains an inference.pdmodel.
        extract_dir = cache_dir / fname[: -len(".tar")]
        if not extract_dir.exists():
            # Serialise across processes (shared models dir) and re-check: another instance may
            # have finished meanwhile.
            with shared_model_lock(extract_dir):
                if not extract_dir.exists():
                    # Unpack beside and rename into place, so an interrupted extraction never
                    # leaves a graph-less dir that is never re-extracted. Per-process staging name.
                    staging = extract_dir.with_name(
                        f"{extract_dir.name}.partial.{os.getpid()}"
                    )
                    shutil.rmtree(staging, ignore_errors=True)
                    with tarfile.open(archive) as tar:
                        base = staging.resolve()
                        for member in tar.getmembers():
                            member_path = (staging / member.name).resolve()
                            if not member_path.is_relative_to(base):
                                raise RuntimeError(f"Unsafe path in tar archive: {member.name}")
                        tar.extractall(staging)
                    staging.rename(extract_dir)
        # Paddle protobuf (.pdmodel) or PIR (.json) graph, at whatever depth the extraction put it.
        for pattern in ("inference.pdmodel", "*.pdmodel", "inference.json", "*.json"):
            hits = sorted(extract_dir.rglob(pattern))
            if hits:
                return hits[0]
        raise FileNotFoundError(f"No inference graph found after extracting {archive}")

    raise ValueError(f"Unsupported model URL (expected .onnx or .tar): {url}")


def _prune_blob_cache(cache_dir: Path, max_bytes: int = _OV_CACHE_MAX_BYTES) -> None:
    """Trim the blob cache to ``max_bytes`` by mtime (OpenVINO only touches blobs on compile)."""
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
    """Download a text asset (a .txt dictionary or a PP-OCRv5 inference.yml)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    return _download_file(url, cache_dir / url.split("/")[-1])


# Detection: preprocessing


def _det_static_shape(
    img_shape: tuple[int, int], limit_side_len: int
) -> tuple[int, int]:
    """Pick the compiled detection shape ``(H, W)`` nearest this aspect ratio (in log space).

    The long side is pinned to ``limit_side_len``; smaller images are scaled up, which keeps the
    number of compiled shapes small.
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
    """Resize (longest side <= limit, multiple of 32) and ImageNet-normalise to ``(1, 3, H, W)``.

    The resize fills the input completely, so post-processing has no padding offset to undo.
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


# Detection: DB post-processing


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


# Recognition: crop + preprocessing


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
    """Resize a crop to fixed height, normalise to [-1, 1] and right-pad its width.

    ``target_w`` (the NPU width rung) pins the padded width; otherwise it follows ``max_wh_ratio``.
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


def _read_character_dict(path: Path) -> list[str]:
    """Read a recogniser's character list from a .txt (PP-OCRv3) or inference.yml (PP-OCRv5 ONNX)."""
    if path.suffix.lower() in (".yml", ".yaml"):
        import yaml

        with open(path, encoding="utf-8") as fh:
            meta = yaml.safe_load(fh)
        try:
            chars = meta["PostProcess"]["character_dict"]
        except (KeyError, TypeError) as exc:
            raise RuntimeError(
                f"No PostProcess.character_dict in {path.name}; it does not "
                f"look like a PaddleOCR inference.yml."
            ) from exc
        # YAML gives str for most entries, but a bare digit line parses as int.
        return [str(c) for c in chars]

    with open(path, "rb") as fh:
        return [
            line.decode("utf-8").strip("\n").strip("\r\n")
            for line in fh.readlines()
        ]


class _CTCLabelDecode:
    """Greedy CTC decoder backed by a character dictionary file."""

    def __init__(self, character_dict_path: str, use_space_char: bool = True):
        chars = _read_character_dict(Path(character_dict_path))
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


# Bidi classes that read left-to-right even inside a right-to-left line:
# Latin and other LTR letters, plus European and Arabic-Indic digits.
_LTR_BIDI = frozenset(("L", "EN", "AN"))


def _visual_to_logical_rtl(text: str) -> str:
    """Reorder one right-to-left line from the recogniser's visual order into reading order.

    Reverses the line, then flips embedded LTR runs (numbers, Latin words) back: a line-level
    approximation of Unicode bidi reordering, adequate for OCR's short single lines.
    """
    out = list(reversed(text))
    start = None
    for i, ch in enumerate(out + [""]):
        # Neutrals (spaces, punctuation) extend a run only if it is already
        # open; a trailing one is trimmed below so it does not absorb the
        # separator between an embedded run and the RTL text around it.
        is_ltr = bool(ch) and unicodedata.bidirectional(ch) in _LTR_BIDI
        is_neutral = bool(ch) and not is_ltr and unicodedata.bidirectional(ch) not in ("R", "AL")
        if is_ltr or (is_neutral and start is not None):
            if start is None:
                start = i
            continue
        if start is not None:
            end = i
            while end > start and unicodedata.bidirectional(out[end - 1]) not in _LTR_BIDI:
                end -= 1
            out[start:end] = reversed(out[start:end])
            start = None
    return "".join(out)


class _Recogniser:
    """One recognition model plus the CTC decoder for its character set.

    ``compiled``/``output`` hold the dynamic-shape model (CPU/GPU); ``static`` the per-width NPU
    cache. Only one of the two is populated.
    """

    def __init__(
        self, lang: str, path: Path, decoder: _CTCLabelDecode, rtl: bool = False
    ) -> None:
        self.lang = lang
        self.path = path
        self.decoder = decoder
        self.rtl = rtl
        self.compiled: Any = None
        self.output: Any = None
        self.static: dict[tuple[int, ...], tuple[Any, Any]] = {}


# Model


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
        lang: str | None = None,
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
        # Language applied when a request does not name one. ``resolve`` raises
        # here rather than at the first inference if the key is nonsense.
        self.lang = languages.resolve(lang).key

        self._det = None
        self._det_out = None
        # Recognisers by language key, built on first use. The preset's own
        # recogniser lives under languages.DEFAULT_LANG and is never evicted.
        self._recognisers: dict[str, _Recogniser] = {}
        self._lang_lru: list[str] = []
        # Static-shape (NPU) path: the detection model file and models compiled per input shape.
        # Unset on CPU/GPU, where one dynamic-shape compilation covers every input.
        self._det_static_path: Path | None = None
        self._compile_cfg: dict[str, Any] = {}
        self._det_cache: dict[tuple[int, ...], tuple[Any, Any]] = {}

    # Loading

    def load(self) -> None:
        core = get_core()
        det_path = _ensure_model_file(self._det_url, self._cache_dir)

        if self._needs_static_shapes():
            # Compiled lazily: an image needs one detection shape and a few recognition widths.
            # CACHE_DIR makes each slow NPU compile happen once per machine.
            self._det_static_path = det_path
            self._compile_cfg = {"CACHE_DIR": str(self._cache_dir / "ov_cache")}
            logger.info(
                f"[{self.name}] {self.device} needs static shapes: detection at "
                f"a {self.det_limit_side_len}px long side, recognition widths "
                f"{list(_REC_WIDTHS)}; compiled on first use."
            )
        else:
            det_model = core.read_model(det_path)
            self._reshape_input(det_model, ov.PartialShape([-1, 3, -1, -1]))
            self._det = core.compile_model(det_model, self.device, openvino_pinned_cpu_config())
            self._det_out = self._det.output(0)

        # Build the startup language now, so a bad dictionary or failed download fails the load
        # rather than the first inference.
        rec = self._recogniser(self.lang)
        logger.info(
            f"[{self.name}] det={Path(det_path).name} "
            f"rec={rec.path.name} lang={rec.lang}"
        )

    def _needs_static_shapes(self) -> bool:
        """True on the NPU, whose compiler rejects unbounded dynamic dimensions."""
        return self.device.split(".")[0].upper() == "NPU"

    # Recognisers (one per language)

    def _recogniser(self, lang: str | None) -> _Recogniser:
        """Return the recogniser for ``lang``, building it on first use (a ~10 MB first download).

        Runs under the base class's model lock, so the cache needs no extra guarding.
        """
        spec = languages.resolve(lang)
        hit = self._recognisers.get(spec.key)
        if hit is not None:
            self._touch_language(spec.key)
            return hit

        if spec.is_default:
            rec_url, dict_url = self._rec_url, self._dict_url
            cache_dir = self._cache_dir
        else:
            rec_url, dict_url = spec.rec_url, spec.dict_url
            # Language packs are keyed by language alone, not by preset, so
            # every preset shares one download of e.g. the Korean recogniser.
            cache_dir = MODELS_DIR / "ppocr" / "lang" / spec.key

        t0 = time.time()
        rec_path = _ensure_model_file(rec_url, cache_dir)
        dict_path = _ensure_text_file(dict_url, cache_dir)
        decoder = _CTCLabelDecode(str(dict_path), use_space_char=True)

        core = get_core()
        rec_model = core.read_model(rec_path)
        self._check_dictionary(spec.key, rec_model, decoder, dict_path)
        rec = _Recogniser(spec.key, rec_path, decoder, rtl=spec.rtl)
        if not self._needs_static_shapes():
            rec_shape = rec_model.input(0).partial_shape
            rec_shape[3] = -1  # dynamic width
            self._reshape_input(rec_model, rec_shape)
            rec.compiled = core.compile_model(rec_model, self.device, openvino_pinned_cpu_config())
            rec.output = rec.compiled.output(0)

        self._recognisers[spec.key] = rec
        self._touch_language(spec.key)
        self._evict_languages()
        logger.info(
            f"[{self.name}] recogniser '{spec.key}' ready in "
            f"{(time.time() - t0) * 1000:.0f} ms "
            f"(rec={rec_path.name} dict={dict_path.name})"
        )
        return rec

    @staticmethod
    def _check_dictionary(
        lang: str,
        rec_model: ov.Model,
        decoder: _CTCLabelDecode,
        dict_path: Path,
    ) -> None:
        """Fail loudly when a dictionary's length doesn't match its recogniser's class count.

        A mismatch silently decodes wrong characters, and upstream publishes similarly named
        dictionaries of different lengths.
        """
        classes = rec_model.output(0).partial_shape[2]
        if not classes.is_static:
            return
        expected = classes.get_length()
        if len(decoder.character) != expected:
            raise RuntimeError(
                f"Dictionary for language '{lang}' does not match its "
                f"recogniser: {dict_path.name} decodes "
                f"{len(decoder.character)} classes but the model emits "
                f"{expected}. The recognised text would be wrong rather than "
                f"merely missing, so the language was not loaded."
            )

    def _touch_language(self, key: str) -> None:
        """Mark ``key`` as most recently used."""
        if key in self._lang_lru:
            self._lang_lru.remove(key)
        self._lang_lru.append(key)

    def _evict_languages(self) -> None:
        """Drop LRU language packs past the cap; the preset's own and the startup one are pinned."""
        pinned = {languages.DEFAULT_LANG, self.lang}
        extras = [k for k in self._lang_lru if k not in pinned]
        for key in extras[: max(0, len(extras) - _MAX_CACHED_LANGUAGES)]:
            self._recognisers.pop(key, None)
            self._lang_lru.remove(key)
            logger.info(f"[{self.name}] released recogniser '{key}' (cache full)")

    def _compiled(
        self,
        path: Path,
        shape: tuple[int, ...],
        cache: dict[tuple[int, ...], tuple[Any, Any]],
    ) -> tuple[Any, Any]:
        """Compile ``path`` at a fixed ``shape``, memoised in ``cache`` (under the model lock)."""
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

    # Inference

    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        drop_score = float(kwargs.get("drop_score", _DEFAULT_DROP_SCORE))
        # Resolved before detection so an unknown language is rejected up front
        # rather than after a pointless detection pass.
        rec = self._recogniser(kwargs.get("lang") or self.lang)
        src_h, src_w = image.shape[:2]

        dt_boxes = self._detect(image)

        if len(dt_boxes) == 0:
            return OCRResult(
                model=self.name,
                regions=[],
                full_text="",
                extra={"device": self.device, "language": rec.lang},
            )

        dt_boxes = _sorted_boxes(dt_boxes)
        crops = [_get_rotate_crop_image(image, box) for box in dt_boxes]
        rec_res = self._recognise(crops, rec)

        regions: list[OCRRegion] = []
        for box, (text, conf) in zip(dt_boxes, rec_res):
            if not text or conf < drop_score:
                continue
            if rec.rtl:
                text = _visual_to_logical_rtl(text)
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
            extra={
                "device": self.device,
                "language": rec.lang,
                "num_detected": len(dt_boxes),
            },
        )

    def _detect(self, image: np.ndarray) -> np.ndarray:
        """Detect text boxes, in original-image coordinates."""
        src_h, src_w = image.shape[:2]
        if self._det_static_path is None:
            net_in = _det_preprocess(image, self.det_limit_side_len)
            det, det_out = self._det, self._det_out
        else:
            shape = _det_static_shape((src_h, src_w), self.det_limit_side_len)
            net_in = _det_preprocess(
                image, self.det_limit_side_len, static_shape=shape
            )
            det, det_out = self._compiled(
                self._det_static_path, (1, 3, *shape), self._det_cache
            )
        return _postprocess_det(det([net_in])[det_out], (src_h, src_w))

    def _recognise(
        self, crops: list[np.ndarray], rec: _Recogniser
    ) -> list[tuple[str, float]]:
        """Batch the crops (sorted by aspect ratio) through recognition; on NPU, one by one."""
        ratios = [c.shape[1] / max(c.shape[0], 1) for c in crops]
        if self._needs_static_shapes():
            # Sorting by aspect ratio only exists to hold a batch's padding
            # down, and this path does not batch, so take them in order.
            return [self._recognise_one(c, r, rec) for c, r in zip(crops, ratios)]

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
            preds = rec.compiled([batch])[rec.output]
            for k, decoded in enumerate(rec.decoder(preds)):
                results[order[beg + k]] = decoded
        return results

    def _recognise_one(
        self, crop: np.ndarray, ratio: float, rec: _Recogniser
    ) -> tuple[str, float]:
        """Recognise one crop at the narrowest compiled width that fits.

        On NPU, batch 1 measured level with batch 6 at narrow widths and ~2.4x faster at the widest,
        compiles faster, caches smaller blobs and pads per crop.
        """
        needed = int(math.ceil(self.rec_image_height * ratio))
        width = next((w for w in _REC_WIDTHS if w >= needed), _REC_WIDTHS[-1])
        compiled, out = self._compiled(
            rec.path,
            (1, 3, self.rec_image_height, width),
            rec.static,
        )
        net_in = _resize_norm_img(
            crop, ratio, self.rec_image_height, target_w=width
        )[np.newaxis, ...]
        return rec.decoder(compiled([net_in])[out])[0]

    def info(self) -> dict[str, Any]:
        info = super().info()
        info["language"] = self.lang
        info["loaded_languages"] = list(self._lang_lru)
        return info

    def _teardown(self) -> None:
        self._det = self._det_out = None
        self._det_static_path = None
        self._det_cache = {}
        self._recognisers = {}
        self._lang_lru = []
