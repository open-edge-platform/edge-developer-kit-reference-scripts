#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UV_CMD="$WORKERS_DIR/thirdparty/uv/uv"
[ -x "$UV_CMD" ] || UV_CMD="uv"

if ! [ -x "$UV_CMD" ] && ! command -v uv >/dev/null 2>&1; then
    echo "ERROR: uv not found."
    echo "Please run the workers setup script first."
    exit 1
fi

cd "$SCRIPT_DIR"
exec "$UV_CMD" run main.py "$@"
