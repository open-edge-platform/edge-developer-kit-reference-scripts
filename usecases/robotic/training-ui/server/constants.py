# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path

DATA_DIR = "./data"
if not Path(f"{DATA_DIR}").exists():
    Path(f"{DATA_DIR}").mkdir(exist_ok=True)
