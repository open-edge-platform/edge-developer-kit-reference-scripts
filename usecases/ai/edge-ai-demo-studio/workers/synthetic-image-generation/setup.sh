#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_THIRDPARTY_DIR="$(dirname "$SCRIPT_DIR")/thirdparty"
UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"

# Function to check if uv is installed
check_uv_installed() {
    echo "Checking if uv is installed..."
    
    if [ -x "$UV_PATH" ]; then
        echo "Found uv in parent thirdparty folder."
        return 0
    else
        echo "uv not found in expected location: $UV_PATH"
        echo "Please ensure the workers setup has been run first."
        exit 1
    fi
}

# Function to install Python dependencies
install_python_dependencies() {
    echo "Checking for virtual environment..."
    if [ -d ".venv" ]; then
        echo "Virtual environment already exists."
    else
        echo "Creating virtual environment with uv..."
        "$UV_PATH" venv
    fi
    
    echo "Installing Python dependencies with uv (this may take a few minutes)..."
    echo "Note: If this seems stuck, it might be resolving PyTorch dependencies..."
    
    if [ -f "requirements.txt" ]; then
        echo "Installing requirements.txt dependencies..."
        "$UV_PATH" pip install -r requirements.txt --refresh --pre --verbose --index-strategy unsafe-best-match
    else
        echo "requirements.txt not found, skipping requirements installation."
    fi
    echo "Python dependencies installed successfully."
}

# Main execution
echo "Starting Synthetic Image Generation Setup..."
cd "$SCRIPT_DIR"
check_uv_installed
install_python_dependencies
echo "Setup completed successfully!"
