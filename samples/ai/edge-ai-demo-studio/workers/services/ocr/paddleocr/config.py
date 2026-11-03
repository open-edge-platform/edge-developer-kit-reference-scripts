# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Defaults for the PaddleOCR worker, overridable from the CLI or ``POST /models/load``."""

from __future__ import annotations

import os
from pathlib import Path
import worker_common

WORKER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = worker_common.project_root()

MODELS_DIR = Path(
    os.environ.get("PADDLEOCR_MODELS_DIR", PROJECT_ROOT / "models" / "ocr")
)
# The Hugging Face cache every worker shares (models/huggingface).
worker_common.use_shared_hf_cache()
worker_common.hf_home().mkdir(parents=True, exist_ok=True)
_MODELSCOPE_CACHE = PROJECT_ROOT / "models" / "modelscope"
os.environ.setdefault("MODELSCOPE_CACHE", str(_MODELSCOPE_CACHE))

DEFAULT_DEVICE = os.environ.get("PADDLEOCR_DEVICE", "AUTO")
DEFAULT_MODEL = os.environ.get("PADDLEOCR_MODEL", "ppocrv5")
DEFAULT_LANG = os.environ.get("PADDLEOCR_LANG", "default")
DEFAULT_CAMERA_SOURCE = os.environ.get("PADDLEOCR_CAMERA_SOURCE", "0")
CAMERA_MIN_INFER_INTERVAL_MS = int(
    os.environ.get("PADDLEOCR_CAMERA_INTERVAL_MS", "300")
)
OCR_JOB_TTL_SECONDS = int(os.environ.get("PADDLEOCR_JOB_TTL_SECONDS", "300"))
DEFAULT_PORT = int(os.environ.get("PADDLEOCR_PORT", "5021"))
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
