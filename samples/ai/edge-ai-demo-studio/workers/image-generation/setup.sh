#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"

UV_PATH="$WORKERS_THIRDPARTY_DIR/uv/uv"
OVMS_PATH="$WORKERS_THIRDPARTY_DIR/ovms/bin/ovms"
OVMS_DIR="$WORKERS_THIRDPARTY_DIR/ovms"

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

check_ovms() {
    if [ -x "$OVMS_PATH" ]; then
        echo "Found OVMS."
        return 0
    fi
    echo "ERROR: OVMS not found at $OVMS_PATH"
    echo "Please run the workers setup script first."
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

setup_ovms_jinja() {
    echo "Installing Jinja2 and MarkupSafe into OVMS lib/python..."
    local OVMS_LIB_PYTHON_DIR="$OVMS_DIR/lib/python"
    if ! "$UV_PATH" pip install --target "$OVMS_LIB_PYTHON_DIR" "Jinja2==3.1.6" "MarkupSafe==3.0.2"; then
        echo "Failed to install Jinja2/MarkupSafe into OVMS lib/python."
        return 1
    fi
    echo "Jinja2/MarkupSafe installed into OVMS lib/python."
    return 0
}

setup_optimum_venv() {
    echo "Setting up Optimum venv for ovms --pull..."

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

    "$UV_PATH" pip install --python "$OPTIMUM_VENV_DIR" modelscope datasets Jinja2==3.1.6 MarkupSafe==3.0.2

    echo "Optimum venv setup completed."
    return 0
}

main() {
    echo "Starting Image Generation setup..."
    cd "$SCRIPT_DIR"
    check_uv
    check_ovms
    setup_ovms_jinja
    setup_optimum_venv
    echo "Image Generation setup completed successfully!"
}

main