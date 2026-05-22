# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import tempfile
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"
}


class ImageStore:
    """
    Manages temporary image storage for inference results
    and masked/cropped images.
    """

    def __init__(self) -> None:
        self._temp_dir = Path(
            tempfile.mkdtemp(prefix="geti_worker_")
        ).resolve()
        logger.info(f"[ImageStore] Temp dir: {self._temp_dir}")

    @property
    def temp_dir(self) -> Path:
        return self._temp_dir

    def save(
        self,
        image_id: str,
        ext: str,
        data: bytes,
    ) -> Path:
        safe_ext = ext if ext.startswith(".") else f".{ext}"
        if safe_ext.lower() not in _ALLOWED_EXTENSIONS:
            safe_ext = ".jpg"
        path = self._temp_dir / f"{image_id}{safe_ext}"
        path.write_bytes(data)
        return path

    def save_masked(
        self,
        image_id: str,
        masked_bgr: np.ndarray,
    ) -> str:
        cropped_id = f"{image_id}_cropped"
        cropped_path = self._temp_dir / f"{cropped_id}.png"
        cv2.imwrite(str(cropped_path), masked_bgr)
        return cropped_id

    def find(self, image_id: str) -> Path:
        for ext in _ALLOWED_EXTENSIONS:
            candidate = self._temp_dir / f"{image_id}{ext}"
            if candidate.exists():
                return candidate
        raise FileNotFoundError(
            f"Temp image not found for id '{image_id}'"
        )