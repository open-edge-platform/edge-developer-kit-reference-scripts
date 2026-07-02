# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path (Split-Path $ScriptDir -Parent) -Parent
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

Push-Location $ScriptDir
try {
    Write-Host "Starting Piper setup..." -ForegroundColor Cyan
    Test-UV
    Write-Host "Resolving dependencies ..." -ForegroundColor Cyan
    & $UVPath sync
    Write-Host "Piper setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Piper setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
