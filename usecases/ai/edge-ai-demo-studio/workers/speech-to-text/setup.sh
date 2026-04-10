#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"
ROOT_DIR="$(dirname "$WORKERS_DIR")"
ROOT_THIRDPARTY_DIR="$ROOT_DIR/thirdparty"

UV_PATH="$WORKERS_THIRDPARTY_DIR/uv/uv"
FFMPEG_PATH="$ROOT_THIRDPARTY_DIR/ffmpeg/bin/ffmpeg"

check_uv() {
    if [ -x "$UV_PATH" ]; then
        echo "Found uv."
        return 0
    fi
    echo "ERROR: uv not found at $UV_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

check_ffmpeg() {
    if [ -x "$FFMPEG_PATH" ]; then
        echo "Found FFmpeg."
        return 0
    fi
    echo "ERROR: FFmpeg not found at $FFMPEG_PATH"
    echo "Please run the main setup script first."
    exit 1
}

main() {
    echo "Starting Speech-to-Text setup..."
    cd "$SCRIPT_DIR"
    check_uv
    check_ffmpeg
    echo "Speech-to-Text setup completed successfully!"
}

main
