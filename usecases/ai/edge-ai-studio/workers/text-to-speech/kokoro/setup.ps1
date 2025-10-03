# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$KokoroFastAPICommitHash = "543cbecc1a36b1d1b1cc90923a47d6178d9374dc"
$EspeakNgVersion = "1.52.0"

# Function to check if uv is installed
function Test-UvInstalled {
    Write-Host "Checking if uv is installed..." -ForegroundColor Yellow
    
    # Use uv from workers thirdparty folder (2 levels up)
    $parentUvPath = Join-Path (Split-Path (Split-Path $PWD -Parent) -Parent) "thirdparty\uv\uv.exe"
    if (Test-Path $parentUvPath) {
        Write-Host "Found uv in workers thirdparty folder." -ForegroundColor Green
        $script:uvCommand = $parentUvPath
        return $true
    } else {
        Write-Host "uv not found in expected location: $parentUvPath" -ForegroundColor Red
        Write-Host "Please ensure the workers setup has been run first." -ForegroundColor Red
        throw "UV not found"
    }
}

# Download and extract espeak-ng if not exists
function Download-EspeakNg {
    if (Test-Path "espeak-ng-$EspeakNgVersion") {
        Write-Host "espeak-ng already exists, skipping download..." -ForegroundColor Green
    } else {
        Write-Host "Downloading espeak-ng..." -ForegroundColor Yellow
        try {
            Invoke-WebRequest -Uri "https://github.com/espeak-ng/espeak-ng/archive/refs/tags/$EspeakNgVersion.zip" -OutFile "espeak-ng-$EspeakNgVersion.zip"
        } catch {
            Write-Host "Failed to download espeak-ng" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }
        
        Write-Host "Extracting espeak-ng..." -ForegroundColor Yellow
        try {
            Expand-Archive -Path "espeak-ng-$EspeakNgVersion.zip" -DestinationPath '.'
        } catch {
            Write-Host "Failed to extract espeak-ng" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }
        
        Write-Host "Cleaning up zip file..." -ForegroundColor Yellow
        try {
            Remove-Item "espeak-ng-$EspeakNgVersion.zip"
        } catch {
            Write-Host "Warning: Failed to delete zip file" -ForegroundColor Yellow
        }
    }
}

# Clone Kokoro-FastAPI if not exists
function Clone-KokoroFastAPI {
    ..\.venv\Scripts\activate.ps1

    if (Test-Path "Kokoro-FastAPI") {
        Write-Host "Kokoro-FastAPI already exists, skipping clone..." -ForegroundColor Green
    } else {
        Write-Host "Cloning Kokoro-FastAPI repository..." -ForegroundColor Yellow

        # Check if Git is installed
        try {
            git --version | Out-Null
        } catch {
            Write-Host "Git not found. Please install Git from: https://github.com/git-for-windows/git/releases" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }

        try {
            git clone https://github.com/remsky/Kokoro-FastAPI
        } catch {
            Write-Host "Failed to clone Kokoro-FastAPI repository" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }
        
        Set-Location Kokoro-FastAPI

        Write-Host "Checking out specific commit..." -ForegroundColor Yellow
        try {
            git checkout $KokoroFastAPICommitHash
        } catch {
            Write-Host "Failed to checkout commit" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }
        
        Write-Host "Applying patch..." -ForegroundColor Yellow
        try {
            git apply --ignore-whitespace ..\..\0001-PATCH-Added-KokoroTTS-OpenVINO-support.patch
        } catch {
            Write-Host "Failed to apply patch" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }
        
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        try {
            & $script:uvCommand sync --active --extra cpu
        } catch {
            Write-Host "Failed to install dependencies" -ForegroundColor Red
            Read-Host "Press Enter to continue..."
            throw
        }

        Set-Location "..\"
    }

    deactivate
}

# Function to download third-party dependencies
function Get-ThirdPartyDependencies {
    Write-Host "Creating thirdparty directory..." -ForegroundColor Yellow
    if (-not (Test-Path ".\thirdparty")) {
        New-Item -ItemType Directory -Path ".\thirdparty" | Out-Null
    }

    Set-Location ".\thirdparty"
    Download-EspeakNg
    Clone-KokoroFastAPI
    Set-Location "..\"
}

# Main execution
try {
    Write-Host "Starting setup for Kokoro FastAPI with Intel GPU support..." -ForegroundColor Green
    Test-UvInstalled
    
    # create a virtual environment if it doesn't exist
    if (Test-Path ".venv") {
        Write-Host "Virtual environment already exists." -ForegroundColor Green
    } else {
        Write-Host "Creating virtual environment with uv..." -ForegroundColor Yellow
        & $script:uvCommand venv --python 3.11
    }
    
    Get-ThirdPartyDependencies
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
}