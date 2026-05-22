# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

# Variables
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$WORKER_DIR = Split-Path -Parent $SCRIPT_DIR
$WORKER_THIRDPARTY_DIR = Join-Path $WORKER_DIR "thirdparty"

$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$UV_CMD = Join-Path $WORKER_THIRDPARTY_DIR "uv\uv.exe"
$PYPROJECT_FILE = Join-Path $SCRIPT_DIR "pyproject.toml"
$DEPLOYMENT_DIR = Join-Path $SCRIPT_DIR "deployment"

Write-Host "Setting up Geti Classifier worker..."
Write-Host "Script dir:     $SCRIPT_DIR"
Write-Host "UV command:     $UV_CMD"
Write-Host "Pyproject file: $PYPROJECT_FILE"

# Check if UV exists in worker thirdparty, fallback to system uv
if (Test-Path $UV_CMD) {
    Write-Host "Using worker UV: $UV_CMD"
} elseif (Get-Command uv -ErrorAction SilentlyContinue) {
    $UV_CMD = "uv"
    Write-Host "Using system UV: $(Get-Command uv | Select-Object -ExpandProperty Source)"
} else {
    Write-Host "Error: UV not found. Please install UV first."
    exit 1
}

# Check if pyproject.toml exists
if (-not (Test-Path $PYPROJECT_FILE)) {
    Write-Host "Error: pyproject.toml not found at $PYPROJECT_FILE"
    exit 1
}

# Create virtual environment
if (-not (Test-Path $VENV_DIR)) {
    Write-Host "Creating virtual environment with Python 3.12..."
    & $UV_CMD venv $VENV_DIR --python 3.12
} else {
    Write-Host "Virtual environment already exists, skipping creation"
}

# Install dependencies
Write-Host "Installing dependencies (this may take a while for OpenVINO)..."
Set-Location $SCRIPT_DIR
& $UV_CMD pip install -r pyproject.toml --python (Join-Path $VENV_DIR "Scripts\python.exe")

# Check deployment folder exists
if (-not (Test-Path $DEPLOYMENT_DIR)) {
    Write-Host ""
    Write-Host "WARNING: Deployment folder not found at $DEPLOYMENT_DIR"
    Write-Host "Please unzip your Geti code deployment ZIP into:"
    Write-Host "  $DEPLOYMENT_DIR"
    Write-Host ""
    Write-Host "Expected structure:"
    Write-Host "  deployment\"
    Write-Host "  +-- project.json"
    Write-Host "  +-- Classification\"
    Write-Host "      +-- model.json"
    Write-Host "      +-- model\"
    Write-Host "      |   +-- model.xml"
    Write-Host "      |   +-- model.bin"
    Write-Host "      |   +-- config.json"
    Write-Host "      +-- python\"
    Write-Host "          +-- requirements.txt"
} else {
    Write-Host "Deployment folder found at $DEPLOYMENT_DIR"
}

Write-Host ""
Write-Host "Geti Classifier worker setup complete!"