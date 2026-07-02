#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../thirdparty/uv/uv"
WAV2LIP_DIR="$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256"

check_uv() {
    if [ -x "$UV_CMD" ]; then
        return 0
    fi
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run the workers setup script first."
    exit 1
}

ensure_wav2lip() {
    if [[ -d "$WAV2LIP_DIR" && -n "$(ls -A "$WAV2LIP_DIR" 2>/dev/null)" ]]; then
        echo "Wav2Lip already set up. Skipping."
        return 0
    fi
    echo "Setting up Wav2Lip..."
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required but not found."
        exit 1
    fi
    rm -rf "$SCRIPT_DIR/tmp/Wav2Lip"
    git clone https://github.com/Rudrabha/Wav2Lip "$SCRIPT_DIR/tmp/Wav2Lip"
    cd "$SCRIPT_DIR/tmp/Wav2Lip"
    git checkout bac9a81e63ecc153202353372e5724b83d9e6322
    git apply "$SCRIPT_DIR/patches/0001-Patch-to-support-256x256-and-xPU.patch"
    cd "$SCRIPT_DIR"
    rm -rf "$WAV2LIP_DIR"
    mkdir -p "$WAV2LIP_DIR"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/face_detection" "$WAV2LIP_DIR/face_detection"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/models" "$WAV2LIP_DIR/"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/audio.py" "$WAV2LIP_DIR/"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/hparams.py" "$WAV2LIP_DIR/"
    rm -rf "$SCRIPT_DIR/tmp"
    echo "Wav2Lip set up successfully."
}

cd "$SCRIPT_DIR"
check_uv
ensure_wav2lip
exec "$UV_CMD" run main.py "$@"
