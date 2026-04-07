# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$ProgressPreference = 'SilentlyContinue'

$SCRIPT_DIR = $PSScriptRoot
$WORKER_DIR = Split-Path $SCRIPT_DIR -Parent
$WORKER_THIRDPARTY_DIR = Join-Path $WORKER_DIR "thirdparty"

$UVPath = Join-Path $WORKER_THIRDPARTY_DIR "uv\uv.exe"
$script:uvCommand = $UVPath

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
Push-Location $PSScriptRoot
try {
    Write-Host "Starting Helper Setup..." -ForegroundColor Green
    Test-UvInstalled
    New-VirtualEnvironment
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}