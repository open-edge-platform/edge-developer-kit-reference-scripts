#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

TTS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_VENV_DIR="$TTS_SCRIPT_DIR/.venv"

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
        "$UV_CMD" venv --seed --python 3.11 "$TTS_VENV_DIR"
    fi
    # shellcheck disable=SC1091
    source "$TTS_VENV_DIR/bin/activate"
    "$UV_CMD" sync
    "$UV_CMD" run python -m ensurepip
    
}

main() {
    echo "Starting setup for Malaya with Intel GPU support ..."
    cd "$TTS_SCRIPT_DIR"
    check_uv_installed
    create_venv
    echo "Setup completed successfully!"
}

main