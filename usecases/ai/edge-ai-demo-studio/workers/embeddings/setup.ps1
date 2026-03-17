# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$SCRIPT_DIR = $PSScriptRoot
$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$ParentThirdPartyDir = Join-Path (Split-Path $PWD -Parent) "thirdparty"
$UVPath = Join-Path $ParentThirdPartyDir "uv\uv.exe"
$OvmsPath = Join-Path $ParentThirdPartyDir "ovms\ovms.exe"
$script:uvCommand = $UVPath

$ROOT_THIRDPARTY_DIR = "$SCRIPT_DIR\..\..\thirdparty"
$PARENT_GIT_PATH = "$ROOT_THIRDPARTY_DIR\git\cmd"

function Add-GitToPath {
    if (Test-Path $PARENT_GIT_PATH) {
        $script:originalPath = $env:PATH
        $env:PATH = "$PARENT_GIT_PATH;$env:PATH"
        Write-Host "Temporarily added Git to PATH: $PARENT_GIT_PATH" -ForegroundColor Green
        return $true
    }
   throw "Git not found in expected location: $PARENT_GIT_PATH"
}

function Remove-GitFromPath {
    if ($script:originalPath) {
        $env:PATH = $script:originalPath
        Write-Host "Restored original PATH" -ForegroundColor Green
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
        Write-Host "uv not found in expected location: $parentUvPath" -ForegroundColor Red
        Write-Host "Please ensure the workers setup has been run first." -ForegroundColor Red
        throw "UV not found"
    }
}

function Test-OVMSInstalled {
    Write-Host "Checking if OpenVINO Model Server is installed..." -ForegroundColor Yellow
    
    if (Test-Path $OvmsPath) {
        Write-Host "OpenVINO Model Server found." -ForegroundColor Green
    } else {
        Write-Host "OpenVINO Model Server not found. Please install it first." -ForegroundColor Red
        throw "OVMS not found"
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
    Write-Host "Starting Embedding Setup..." -ForegroundColor Green
    Push-Location -Path $PSScriptRoot
    Add-GitToPath
    Test-UvInstalled
    Test-OVMSInstalled
    New-VirtualEnvironment
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally{
    Remove-GitFromPath
    Pop-Location
}