# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Face-recognition worker defaults, overridable from the CLI or ``POST /models/load``."""

from __future__ import annotations

import os
from pathlib import Path

from worker_common import AUTO_DEVICE, models_dir

# <repo>/models/face-recognition -- the frontend's modelDirectories entry.
MODELS_DIR = Path(
    os.environ.get("FACE_RECOGNITION_MODELS_DIR", models_dir("face-recognition"))
)

DEFAULT_DEVICE = os.environ.get("FACE_RECOGNITION_DEVICE", AUTO_DEVICE)
DEFAULT_MODEL = os.environ.get("FACE_RECOGNITION_MODEL", "omz-retail")
DEFAULT_PORT = int(os.environ.get("FACE_RECOGNITION_PORT", "8032"))
