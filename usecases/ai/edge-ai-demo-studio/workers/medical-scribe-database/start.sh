#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_PATH="$SCRIPT_DIR/../thirdparty/uv/uv"

if [ ! -x "$UV_PATH" ]; then
    echo "ERROR: uv not found at $UV_PATH"
    echo "Please run workers/setup.sh and workers/database/setup.sh first."
    exit 1
fi

cd "$SCRIPT_DIR"
exec "$UV_PATH" run main.py "$@"
