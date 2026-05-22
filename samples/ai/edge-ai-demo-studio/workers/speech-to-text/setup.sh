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

OVMS_VERSION="v2025.4.1"
OPTIMUM_VENV_DIR="thirdparty/.venv"
OPTIMUM_EXPORT_MODEL_URL="https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/${OVMS_VERSION}/demos/common/export_models"
OPTIMUM_EXPORT_MODEL_REQUIREMENTS="requirements.txt"
OPTIMUM_EXPORT_MODEL_SCRIPT="export_model.py"

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

download_file() {
    local url="$1"
    local output="$2"
    local description="${3:-file}"

    echo "Downloading $description..."
    if ! curl -L --progress-bar "$url" -o "$output"; then
        echo "Failed to download $description from $url"
        return 1
    fi
    echo "Downloaded $description."
    return 0
}

setup_optimum_venv() {
    echo "Setting up Optimum venv for model export..."

    if [[ -d "$OPTIMUM_VENV_DIR" ]]; then
        echo "Optimum venv already exists at $OPTIMUM_VENV_DIR. Skipping."
        return 0
    fi

    mkdir -p "thirdparty"

    echo "Creating Optimum venv at $OPTIMUM_VENV_DIR..."
    "$UV_PATH" venv "$OPTIMUM_VENV_DIR" --clear

    echo "Downloading Optimum export model requirements..."
    if ! download_file "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS" \
        "thirdparty/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS" "Optimum Export Model requirements"; then
        return 1
    fi

    echo "Downloading Optimum export model script..."
    if ! download_file "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_SCRIPT" \
        "thirdparty/$OPTIMUM_EXPORT_MODEL_SCRIPT" "Optimum Export Model script"; then
        return 1
    fi

    echo "Installing Optimum export model dependencies into venv..."
    "$UV_PATH" pip install --python "$OPTIMUM_VENV_DIR" \
        --prerelease allow --index-strategy unsafe-best-match \
        -r "thirdparty/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS"

    echo "Optimum venv setup completed."
    return 0
}

main() {
    echo "Starting Speech-to-Text setup..."
    cd "$SCRIPT_DIR"
    check_uv
    check_ffmpeg
    setup_optimum_venv
    echo "Speech-to-Text setup completed successfully!"
}

main
