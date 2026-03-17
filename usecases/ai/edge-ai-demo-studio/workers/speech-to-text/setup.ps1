# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$SCRIPT_DIR = $PSScriptRoot
$WORKER_DIR = Split-Path $SCRIPT_DIR -Parent
$WORKER_THIRDPARTY_DIR = Join-Path $WORKER_DIR "thirdparty"
$HOME_DIR = Split-Path $WORKER_DIR -Parent
$HOME_THIRDPARTY_DIR = Join-Path $HOME_DIR "thirdparty"

$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$UVPath = Join-Path $WORKER_THIRDPARTY_DIR "uv\uv.exe"
$script:uvCommand = $UVPath
$FFmpegPath = Join-Path $HOME_THIRDPARTY_DIR "ffmpeg\bin\ffmpeg.exe"

# Function to check if FFmpeg is available
function Test-FFmpegAvailable {
    Write-Host "Checking if FFmpeg is available..." -ForegroundColor Yellow
    
    if (Test-Path $FFmpegPath) {
        Write-Host "Found FFmpeg in thirdparty folder." -ForegroundColor Green
        return $true
    } else {
        Write-Host "FFmpeg not found in thirdparty folder." -ForegroundColor Red
        Write-Host "Please ensure the workers setup has been run first to install FFmpeg." -ForegroundColor Red
        throw "FFmpeg not found"
    }
}

# Function to check if uv is installed
function Test-UvInstalled {
    Write-Host "Checking if uv is installed..." -ForegroundColor Yellow
    
    # Use uv from parent thirdparty folder
    if (Test-Path $UVPath) {
        Write-Host "Found uv in parent thirdparty folder." -ForegroundColor Green
        return $true
    } else {
        Write-Host "uv not found in expected location: $UVPath" -ForegroundColor Red
        Write-Host "Please ensure the workers setup has been run first." -ForegroundColor Red
        throw "UV not found"
    }
}

function New-VirtualEnvironment {
    if (Test-Path $VENV_DIR) {
        Write-Host "Virtual environment already exists at $VENV_DIR." -ForegroundColor Green
    } else {
        Write-Host "Creating Python 3.11 virtual environment with uv ..." -ForegroundColor Yellow
        & $script:uvCommand venv --python 3.11 --seed
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create virtual environment. uv venv exited with code $LASTEXITCODE"
        }
    }
    & $script:uvCommand sync
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to sync dependencies. uv sync exited with code $LASTEXITCODE"
    }
    & $script:uvCommand run python -m ensurepip
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to ensure pip. uv run exited with code $LASTEXITCODE"
    }
}

# Main execution
try {
    Write-Host "Starting Speech-to-Text Setup..." -ForegroundColor Green
    Test-FFmpegAvailable
    Test-UvInstalled
    New-VirtualEnvironment
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}