# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
$SCRIPT_DIR = $PSScriptRoot
$ROOT_THIRDPARTY_DIR = "$SCRIPT_DIR\..\..\..\thirdparty"
$PARENT_GIT_PATH = "$ROOT_THIRDPARTY_DIR\git\cmd"

function Add-GitToPath {
    if (Test-Path $PARENT_GIT_PATH) {
        $script:originalPath = $env:PATH
        $env:PATH = "$PARENT_GIT_PATH;$env:PATH"
        Write-Host "Temporarily added Git to PATH: $PARENT_GIT_PATH" -ForegroundColor Green
        return $true
    }
    return $false
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


# Main execution
try {
    Write-Host "Starting setup for Malaya FastAPI with Intel GPU support..." -ForegroundColor Green
    Push-Location -Path $PSScriptRoot
    Add-GitToPath
    Test-UvInstalled

    & $script:uvCommand sync
    
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
}
finally{
    Remove-GitFromPath
    Pop-Location
}