# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Central configuration and defaults for the PaddleOCR worker.

Everything here can be overridden from the CLI (see ``main.py``) or via the
``POST /models/load`` endpoint, so the defaults below are just the
out-of-the-box behaviour.
"""

from __future__ import annotations

import os
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = WORKER_DIR.parents[2]

MODELS_DIR = Path(
    os.environ.get("PADDLEOCR_MODELS_DIR", PROJECT_ROOT / "models" / "ocr")
)
_HF_HOME = PROJECT_ROOT / "models" / "huggingface"
_MODELSCOPE_CACHE = PROJECT_ROOT / "models" / "modelscope"
_HF_HOME.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(_HF_HOME))
os.environ.setdefault("MODELSCOPE_CACHE", str(_MODELSCOPE_CACHE))

DEFAULT_DEVICE = os.environ.get("PADDLEOCR_DEVICE", "AUTO")
DEFAULT_MODEL = os.environ.get("PADDLEOCR_MODEL", "ppocrv5")
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
