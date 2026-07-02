#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../thirdparty/uv/uv"
OVMS_PATH="$SCRIPT_DIR/../thirdparty/ovms/bin/ovms"

check_uv() {
    if [ -x "$UV_CMD" ]; then
        return 0
    fi
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run the workers setup script first."
    exit 1
}

check_ovms() {
    if [ -x "$OVMS_PATH" ]; then
        return 0
    fi
    echo "ERROR: OVMS not found at $OVMS_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

cd "$SCRIPT_DIR"
check_uv
check_ovms
exec "$UV_CMD" run main.py "$@"
