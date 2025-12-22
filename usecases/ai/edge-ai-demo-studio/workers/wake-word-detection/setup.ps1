# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$SCRIPT_DIR = $PSScriptRoot
$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$ParentThirdPartyDir = Join-Path (Split-Path $PWD -Parent) "thirdparty"
$UVPath = Join-Path $ParentThirdPartyDir "uv\uv.exe"
$script:uvCommand = $UVPath

$ROOT_THIRDPARTY_DIR = "$SCRIPT_DIR\..\..\thirdparty"
$PARENT_GIT_PATH = "$ROOT_THIRDPARTY_DIR\git\cmd"

# Function to check if uv is installed
function Test-UvInstalled {
    Write-Host "Checking if uv is installed..." -ForegroundColor Yellow
    
    # Use uv from parent thirdparty folder
    if (Test-Path $UVPath) {
        Write-Host "Found uv in parent thirdparty folder." -ForegroundColor Green
        return $true
    } else {
        Write-Host "uv not found in expected location: $parentUvPath" -ForegroundColor Red
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
    Write-Host "Starting Wake Word Detection Setup..." -ForegroundColor Green
    Push-Location -Path $PSScriptRoot
    Test-UvInstalled
    New-VirtualEnvironment
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally{
    Pop-Location
}