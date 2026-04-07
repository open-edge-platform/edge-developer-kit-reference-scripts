#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_THIRDPARTY_DIR="$WORKER_DIR/thirdparty"

UV_CMD="$WORKER_THIRDPARTY_DIR/uv/uv"

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
    echo "Installing Python dependencies with uv (this may take a few minutes)..."
    echo "Note: If this seems stuck, it might be resolving PyTorch dependencies..."
    
    "$UV_CMD" sync
    echo "Python dependencies installed successfully."
}

# Main execution
echo "Starting Helper Setup..."
cd "$SCRIPT_DIR"
check_uv_installed
install_python_dependencies
echo "Setup completed successfully!"