# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Image decode / encode helpers shared by every input mode."""

from __future__ import annotations

import base64

import cv2
import numpy as np


class ImageDecodeError(ValueError):
    """Raised when raw bytes cannot be decoded into an image."""


def decode_image(data: bytes) -> np.ndarray:
    """Decode raw image bytes (JPG/PNG/BMP/...) into a BGR ``np.ndarray``."""
    if not data:
        raise ImageDecodeError("Empty image payload")
    arr = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ImageDecodeError(
            "Could not decode image. Supported: JPG, PNG, BMP, TIFF, WEBP"
        )
    return bgr


def encode_jpeg_base64(bgr: np.ndarray, quality: int = 90) -> str:
    """Encode a BGR image as a base64 data URL (used for gallery thumbnails)."""
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
