# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$ParentThirdPartyDir = Join-Path (Split-Path $PWD -Parent) "thirdparty"
$UVPath = Join-Path $ParentThirdPartyDir "uv\uv.exe"
$script:uvCommand = $UVPath
$FFmpegPath = Join-Path $ParentThirdPartyDir "ffmpeg\bin\ffmpeg.exe"

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

# Function to install Python dependencies
function Install-PythonDependencies {
    Write-Host "Checking for virtual environment..." -ForegroundColor Yellow
    if (Test-Path ".venv") {
        Write-Host "Virtual environment already exists." -ForegroundColor Green
    } else {
        Write-Host "Creating virtual environment with uv..." -ForegroundColor Yellow
        & $script:uvCommand venv
    }
    
    Write-Host "Installing Python dependencies with uv (this may take a few minutes)..." -ForegroundColor Yellow
    Write-Host "Note: If this seems stuck, it might be resolving PyTorch dependencies..." -ForegroundColor Cyan
    
    try {
        if (Test-Path "requirements.txt") {
            Write-Host "Installing requirements.txt dependencies..." -ForegroundColor Yellow
            & $script:uvCommand pip install -r requirements.txt --refresh --pre --verbose --index-strategy unsafe-best-match
        } else {
            Write-Host "requirements.txt not found, skipping requirements installation." -ForegroundColor Yellow
        }
        Write-Host "Python dependencies installed successfully." -ForegroundColor Green
    } catch {
        Write-Host "Failed to install Python dependencies." -ForegroundColor Red
        throw
    }
}

# Main execution
try {
    Write-Host "Starting Speech-to-Text Setup..." -ForegroundColor Green
    Test-UvInstalled
    Test-FFmpegAvailable
    Install-PythonDependencies
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
}