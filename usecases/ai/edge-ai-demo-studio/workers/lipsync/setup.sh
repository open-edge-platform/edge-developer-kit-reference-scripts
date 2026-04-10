#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"

UV_PATH="$WORKERS_THIRDPARTY_DIR/uv/uv"

check_uv() {
    if [ -x "$UV_PATH" ]; then
        echo "Found uv."
        return 0
    fi
    echo "ERROR: uv not found at $UV_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

setup_wav2lip() {
    echo "Installing Wav2Lip dependencies..."

    rm -rf "$SCRIPT_DIR/tmp/Wav2Lip"
    git clone https://github.com/Rudrabha/Wav2Lip "$SCRIPT_DIR/tmp/Wav2Lip"
    cd "$SCRIPT_DIR/tmp/Wav2Lip"
    git checkout bac9a81e63ecc153202353372e5724b83d9e6322
    git apply "$SCRIPT_DIR/patches/0001-Patch-to-support-256x256-and-xPU.patch"

    cd "$SCRIPT_DIR"
    rm -rf "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256"

    mkdir -p "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/face_detection" "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256/face_detection"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/models" "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256/"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/audio.py" "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256/"
    cp -rf "$SCRIPT_DIR/tmp/Wav2Lip/hparams.py" "$SCRIPT_DIR/modules/lipsync/wav2lip/wav2lip256/"

    rm -rf "$SCRIPT_DIR/tmp"
    echo "Wav2Lip dependencies installed."
}

main() {
    echo "Starting Lipsync setup..."
    cd "$SCRIPT_DIR"
    check_uv
    setup_wav2lip
    echo "Lipsync setup completed successfully!"
}

main