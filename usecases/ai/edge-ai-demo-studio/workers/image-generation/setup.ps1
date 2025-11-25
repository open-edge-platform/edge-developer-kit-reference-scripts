# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$SCRIPT_DIR = $PSScriptRoot
$ParentThirdPartyDir = Join-Path (Split-Path $SCRIPT_DIR -Parent) "thirdparty"
$UVPath = Join-Path $ParentThirdPartyDir "uv\uv.exe"
$OvmsPath = Join-Path $ParentThirdPartyDir "ovms\ovms.exe"
$script:uvCommand = $UVPath

$ROOT_THIRDPARTY_DIR = Join-Path (Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent) "thirdparty"
Write-Host "Parent thirdparty directory: $ParentThirdPartyDir" -ForegroundColor Yellow
Write-Host "Root thirdparty directory: $ROOT_THIRDPARTY_DIR" -ForegroundColor Yellow
$PARENT_GIT_PATH = Join-Path $ROOT_THIRDPARTY_DIR "git\cmd"

function Add-GitToPath {
    Write-Host $PARENT_GIT_PATH
    if (Test-Path $PARENT_GIT_PATH) {
        $script:originalPath = $env:PATH
        $env:PATH = "$PARENT_GIT_PATH;$env:PATH"
        Write-Host "Temporarily added Git to PATH: $PARENT_GIT_PATH" -ForegroundColor Green
        return $true
    }
    return $false
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

function Test-OVMSInstalled {
    Write-Host "Checking if OpenVINO Model Server is installed..." -ForegroundColor Yellow
    
    if (Test-Path $OvmsPath) {
        Write-Host "OpenVINO Model Server found." -ForegroundColor Green
    } else {
        Write-Host "OpenVINO Model Server not found. Please install it first." -ForegroundColor Red
        throw "OVMS not found"
    }
}

# Function to install Python dependencies
function Install-PythonDependencies {
    Write-Host "Checking for virtual environment..." -ForegroundColor Yellow
    if (Test-Path ".venv") {
        Write-Host "Virtual environment already exists." -ForegroundColor Green
    } else {
        Write-Host "Creating virtual environment with uv..." -ForegroundColor Yellow
        & $script:uvCommand venv
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create virtual environment. uv venv exited with code $LASTEXITCODE"
        }
    }
    
    Write-Host "Installing Python dependencies with uv (this may take a few minutes)..." -ForegroundColor Yellow
    Write-Host "Note: If this seems stuck, it might be resolving PyTorch dependencies..." -ForegroundColor Cyan
    
    if (Test-Path "requirements.txt") {
        Write-Host "Installing requirements.txt dependencies..." -ForegroundColor Yellow
        & $script:uvCommand pip install -r requirements.txt --refresh --pre --verbose --index-strategy unsafe-best-match
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install Python dependencies. uv pip install exited with code $LASTEXITCODE"
        }
        Write-Host "Python dependencies installed successfully." -ForegroundColor Green
    } else {
        Write-Host "requirements.txt not found, skipping requirements installation." -ForegroundColor Yellow
    }
}

# Main execution
try {
    Write-Host "Starting Image Generation Setup..." -ForegroundColor Green
    Test-UvInstalled
    Test-OVMSInstalled
    Add-GitToPath
    Install-PythonDependencies
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}