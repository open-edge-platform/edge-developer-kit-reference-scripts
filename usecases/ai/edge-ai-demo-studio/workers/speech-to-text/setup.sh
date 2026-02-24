#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_THIRDPARTY_DIR="$WORKER_DIR/thirdparty"
HOME_DIR="$(dirname "$WORKER_DIR")"
HOME_THIRDPARTY_DIR="$HOME_DIR/thirdparty"

VENV_DIR="$SCRIPT_DIR/.venv"
UV_PATH="$WORKER_THIRDPARTY_DIR/uv/uv"
FFMPEG_PATH="$HOME_THIRDPARTY_DIR/ffmpeg/bin/ffmpeg"

# Function to check if FFmpeg is available
check_ffmpeg_available() {
    echo "Checking if FFmpeg is available..."
    
    if [ -x "$FFMPEG_PATH" ]; then
        echo "Found FFmpeg in thirdparty folder."
        return 0
    else
        echo "FFmpeg not found in thirdparty folder: $FFMPEG_PATH"
        echo "Please ensure the workers setup has been run first to install FFmpeg."
        exit 1
    fi
}

# Function to check if uv is installed
check_uv_installed() {
    echo "Checking if uv is installed..."
    
    if [ -x "$UV_CMD" ]; then
        echo "Found uv in parent thirdparty folder."
        return 0
    else
        echo "uv not found in expected location: $UV_CMD"
        echo "Please ensure the workers setup has been run first."
        exit 1
    fi
}

# Function to install Python dependencies
install_python_dependencies() {
    echo "Checking for virtual environment..."
    if [ -d "$VENV_DIR" ]; then
        echo "Virtual environment already exists."
    else
        echo "Creating Python 3.11 virtual environment with uv ..."
        "$UV_CMD" venv --seed --python 3.11 "$VENV_DIR"
    fi
    
    echo "Installing Python dependencies with uv (this may take a few minutes)..."
    echo "Note: If this seems stuck, it might be resolving PyTorch dependencies..."
    
    "$UV_PATH" sync
    echo "Python dependencies installed successfully."
}

# Main execution
echo "Starting Speech-to-Text Setup..."
cd "$SCRIPT_DIR"
check_uv_installed
check_ffmpeg_available
install_python_dependencies
echo "Setup completed successfully!"