#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"
UV_CMD="$WORKERS_THIRDPARTY_DIR/uv/uv"

main() {
    cd "$SCRIPT_DIR"
    "$UV_CMD" run main.py "$@"
}

main "$@"
