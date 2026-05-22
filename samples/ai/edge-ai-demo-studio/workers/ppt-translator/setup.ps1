# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

# Variables
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$WORKER_DIR = Split-Path -Parent $SCRIPT_DIR
$WORKER_THIRDPARTY_DIR = Join-Path $WORKER_DIR "thirdparty"

$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$UV_CMD = Join-Path $WORKER_THIRDPARTY_DIR "uv\uv.exe"

Write-Host "Setting up PPT Translator worker..."

# Create virtual environment and install dependencies
if (-not (Test-Path $VENV_DIR)) {
    Write-Host "Creating virtual environment..."
    & $UV_CMD venv $VENV_DIR --python 3.12
}

Write-Host "Installing dependencies..."
& $UV_CMD pip install -r pyproject.toml --python (Join-Path $VENV_DIR "Scripts\python.exe")

# Create necessary directories
New-Item -ItemType Directory -Force -Path (Join-Path $SCRIPT_DIR "file\uploads")
New-Item -ItemType Directory -Force -Path (Join-Path $SCRIPT_DIR "file\outputs")

Write-Host "PPT Translator worker setup complete!"
