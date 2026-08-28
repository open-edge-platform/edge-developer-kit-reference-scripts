# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Central configuration and defaults for the face-recognition worker.

Everything here can be overridden from the CLI (see ``main.py``) or via the
``POST /models/load`` endpoint, so the defaults below are just the
out-of-the-box behaviour.
"""

from __future__ import annotations

import os
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = WORKER_DIR.parents[1]

MODELS_DIR = Path(
    os.environ.get(
        "FACE_RECOGNITION_MODELS_DIR", PROJECT_ROOT / "models" / "face-recognition"
    )
)

DEFAULT_DEVICE = os.environ.get("FACE_RECOGNITION_DEVICE", "AUTO")
DEFAULT_MODEL = os.environ.get("FACE_RECOGNITION_MODEL", "omz-retail")
DEFAULT_PORT = int(os.environ.get("FACE_RECOGNITION_PORT", "8031"))
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
