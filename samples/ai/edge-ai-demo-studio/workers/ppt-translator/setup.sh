#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_THIRDPARTY_DIR="$WORKER_DIR/thirdparty"

VENV_DIR="$SCRIPT_DIR/.venv"
UV_CMD="$WORKER_THIRDPARTY_DIR/uv/uv"
PYPROJECT_FILE="$SCRIPT_DIR/pyproject.toml"

echo "Setting up PPT Translator worker..."
echo "Script dir: $SCRIPT_DIR"
echo "UV command: $UV_CMD"
echo "Pyproject file: $PYPROJECT_FILE"

# Check if UV exists in worker thirdparty, fallback to system uv
if [ -x "$UV_CMD" ]; then
    echo "Using worker UV: $UV_CMD"
elif command -v uv &> /dev/null; then
    UV_CMD="uv"
    echo "Using system UV: $(which uv)"
else
    echo "Error: UV not found"
    exit 1
fi

# Check if pyproject.toml exists
if [ ! -f "$PYPROJECT_FILE" ]; then
    echo "Error: pyproject.toml not found at $PYPROJECT_FILE"
    exit 1
fi

# Create virtual environment and install dependencies
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    "$UV_CMD" venv "$VENV_DIR" --python 3.12
else
    echo "Virtual environment already exists"
fi

echo "Installing dependencies..."
# Change to the script directory to ensure UV finds pyproject.toml
cd "$SCRIPT_DIR"
"$UV_CMD" pip install -r pyproject.toml --python "$VENV_DIR/bin/python"

# Create necessary directories
mkdir -p "$SCRIPT_DIR/file/uploads"
mkdir -p "$SCRIPT_DIR/file/outputs"

echo "PPT Translator worker setup complete!"
