# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import yaml
from pathlib import Path

def read_config(path):
    filepath = Path(path)
    with open(filepath.as_posix(), 'r') as f:
        config = yaml.safe_load(f)

    return config

