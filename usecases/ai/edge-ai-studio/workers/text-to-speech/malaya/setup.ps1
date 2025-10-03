# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

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
    Test-UvInstalled

    & $script:uvCommand sync
    
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
}