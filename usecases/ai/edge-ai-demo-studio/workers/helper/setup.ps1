# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Install-PythonDependencies {
    Write-Host "Setting up Helper..." -ForegroundColor Cyan
    & $UVPath sync
    if ($LASTEXITCODE -ne 0) {
        throw "uv sync failed with exit code $LASTEXITCODE"
    }
    Write-Host "Helper setup completed." -ForegroundColor Green

}

Push-Location $ScriptDir
try {
    Write-Host "Starting Helper setup..." -ForegroundColor Cyan
    Test-UV
    Install-PythonDependencies
    Write-Host "Helper setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Helper setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}