#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

KOKORO_COMMIT_HASH="543cbecc1a36b1d1b1cc90923a47d6178d9374dc"
TTS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_VENV_DIR="$TTS_SCRIPT_DIR/.venv"
TTS_THIRDPARTY_DIR="$TTS_SCRIPT_DIR/thirdparty"
KOKORO_DIR="$TTS_THIRDPARTY_DIR/Kokoro-FastAPI"
KOKORO_PATCH_FILE="$TTS_SCRIPT_DIR/0001-PATCH-Added-KokoroTTS-OpenVINO-support.patch"

check_uv_installed() {
    echo -e "Checking if uv is installed in workers thirdparty directory..."
    PARENT_UV_PATH="$(dirname "$(dirname "$PWD")")/thirdparty/uv/uv"
    if [ -x "$PARENT_UV_PATH" ]; then
        echo -e "Found uv in workers thirdparty folder."
        UV_CMD="$PARENT_UV_PATH"
    else
        echo -e "uv not found in expected location: $PARENT_UV_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

create_venv() {
    if [[ -d "$TTS_VENV_DIR" ]]; then
        echo "Virtual environment already exists at $TTS_VENV_DIR."
    else
        echo "Creating Python 3.11 virtual environment with uv ..."
        "$UV_CMD" venv --python 3.11 "$TTS_VENV_DIR"
    fi
    if [ -f "$TTS_VENV_DIR/bin/activate" ]; then
        # shellcheck disable=SC1091
        source "$TTS_VENV_DIR/bin/activate"
    else
        echo "Notice: $TTS_VENV_DIR/bin/activate not found; continuing without it"
    fi
}

clone_kokoro_fastapi() {
    mkdir -p "$TTS_THIRDPARTY_DIR"
    cd "$TTS_THIRDPARTY_DIR"
    if [[ -d "Kokoro-FastAPI" ]]; then
        echo "Kokoro-FastAPI already exists. Skipping clone."
    else
        echo "Cloning Kokoro-FastAPI repository ..."
        git clone https://github.com/remsky/Kokoro-FastAPI
        cd Kokoro-FastAPI
        git checkout "$KOKORO_COMMIT_HASH"
        cd ..
    fi
    if [[ -f "$KOKORO_PATCH_FILE" ]]; then
        echo "Applying patch for Intel GPU support ..."
        cd Kokoro-FastAPI
        git apply --ignore-whitespace "$KOKORO_PATCH_FILE" || true
        cd ..
    fi
    cd "$KOKORO_DIR"
    echo "Syncing uv dependencies ..."
    $UV_CMD sync --active --extra cpu
    cd "$TTS_SCRIPT_DIR"
}

main() {
    echo "Starting setup for Kokoro FastAPI with Intel GPU support ..."
    cd "$TTS_SCRIPT_DIR"
    check_uv_installed
    create_venv
    clone_kokoro_fastapi
    echo "Setup completed successfully!"
}

main
