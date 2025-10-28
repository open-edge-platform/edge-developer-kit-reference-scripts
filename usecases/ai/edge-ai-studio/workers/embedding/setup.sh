#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PARENT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
PARENT_UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"
PARENT_OVMS_PATH="$PARENT_THIRDPARTY_DIR/ovms/bin/ovms"
UV_CMD="$PARENT_UV_PATH"

# Function to check if uv is installed in parent thirdparty directory
check_uv_installed() {
    echo -e "Checking if uv is installed in parent thirdparty directory..."
    if [ -x "$PARENT_UV_PATH" ]; then
        echo -e "Found uv in parent thirdparty folder."
    else
        echo -e "uv not found in expected location: $PARENT_UV_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

check_ovms_installed() {
    echo "Checking if OVMS is installed in parent thirdparty directory..."
    if [ -x "$PARENT_OVMS_PATH" ]; then
        echo -e "Found OVMS in parent thirdparty folder."
    else
        echo -e "OVMS not found in expected location: $PARENT_OVMS_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

# Function to install Python dependencies
install_python_dependencies() {
    echo -e "Checking for virtual environment..."
    if [ -d ".venv" ]; then
        echo -e "Virtual environment already exists."
    else
        echo -e "Creating virtual environment with uv..."
        "$UV_CMD" venv --python 3.11
    fi

    echo -e "Installing Python dependencies with uv (this may take a few minutes)..."
    echo -e "Note: If this seems stuck, it might be resolving PyTorch dependencies..."

    if [ -f "requirements.txt" ]; then
        echo -e "Installing requirements.txt dependencies..."
        if "$UV_CMD" pip install -r requirements.txt --verbose --pre --refresh --index-strategy unsafe-best-match; then
            echo -e "Python dependencies installed successfully."
        else
            echo -e "Failed to install Python dependencies."
            exit 1
        fi
    else
        echo -e "requirements.txt not found, skipping requirements installation."
    fi
}


# No third-party dependency download in this worker script (handled by parent setup)

main() {
    echo -e "Starting Embedding Setup..."
    cd "$SCRIPT_DIR"
    check_ovms_installed
    check_uv_installed
    install_python_dependencies
    echo "Setup completed successfully!"
}

main
