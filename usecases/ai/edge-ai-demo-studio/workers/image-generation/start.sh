#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../thirdparty/uv/uv"

cd "$SCRIPT_DIR"
"$UV_CMD" venv --seed --clear
"$UV_CMD" pip install -r requirements.txt
exec "$UV_CMD" run main.py "$@"
