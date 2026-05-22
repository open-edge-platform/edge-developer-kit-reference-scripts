#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"

UV_PATH="$WORKERS_THIRDPARTY_DIR/uv/uv"
OVMS_PATH="$WORKERS_THIRDPARTY_DIR/ovms/bin/ovms"

check_uv() {
    if [ -x "$UV_PATH" ]; then
        echo "Found uv."
        return 0
    fi
    echo "ERROR: uv not found at $UV_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

check_ovms() {
    if [ -x "$OVMS_PATH" ]; then
        echo "Found OVMS."
        return 0
    fi
    echo "ERROR: OVMS not found at $OVMS_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

main() {
    echo "Starting VectorDB setup..."
    cd "$SCRIPT_DIR"
    check_uv
    check_ovms
    echo "VectorDB setup completed successfully!"
}

main
