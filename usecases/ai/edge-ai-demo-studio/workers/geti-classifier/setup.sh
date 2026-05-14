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
DEPLOYMENT_DIR="$SCRIPT_DIR/deployment"

echo "Setting up Geti Classifier worker..."
echo "Script dir:     $SCRIPT_DIR"
echo "UV command:     $UV_CMD"
echo "Pyproject file: $PYPROJECT_FILE"

# Check if UV exists in worker thirdparty, fallback to system uv
if [ -x "$UV_CMD" ]; then
    echo "Using worker UV: $UV_CMD"
elif command -v uv &> /dev/null; then
    UV_CMD="uv"
    echo "Using system UV: $(which uv)"
else
    echo "Error: UV not found. Please install UV first."
    exit 1
fi

# Check if pyproject.toml exists
if [ ! -f "$PYPROJECT_FILE" ]; then
    echo "Error: pyproject.toml not found at $PYPROJECT_FILE"
    exit 1
fi

# Create virtual environment
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment with Python 3.12..."
    "$UV_CMD" venv "$VENV_DIR" --python 3.12
else
    echo "Virtual environment already exists, skipping creation"
fi

# Install dependencies
echo "Installing dependencies (this may take a while for OpenVINO)..."
cd "$SCRIPT_DIR"
"$UV_CMD" pip install -r pyproject.toml --python "$VENV_DIR/bin/python"

# Check deployment folder exists
if [ ! -d "$DEPLOYMENT_DIR" ]; then
    echo ""
    echo "WARNING: Deployment folder not found at $DEPLOYMENT_DIR"
    echo "Please unzip your Geti code deployment ZIP into:"
    echo "  $DEPLOYMENT_DIR"
    echo ""
    echo "Expected structure:"
    echo "  deployment/"
    echo "  ├── project.json"
    echo "  └── Classification/"
    echo "      ├── model.json"
    echo "      ├── model/"
    echo "      │   ├── model.xml"
    echo "      │   ├── model.bin"
    echo "      │   └── config.json"
    echo "      └── python/"
    echo "          └── requirements.txt"
else
    echo "Deployment folder found at $DEPLOYMENT_DIR"
fi

echo ""
echo "Geti Classifier worker setup complete!"