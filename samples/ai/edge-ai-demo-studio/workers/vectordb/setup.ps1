# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$OvmsPath = Join-Path $WorkersThirdPartyDir "ovms\ovms.exe"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-OVMS {
    if (Test-Path $OvmsPath) {
        Write-Host "Found OVMS."
        return
    }
    Write-Host "ERROR: OVMS not found at $OvmsPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Push-Location $ScriptDir
try {
    Write-Host "Starting VectorDB setup..." -ForegroundColor Cyan
    Test-UV
    Test-OVMS
    Write-Host "VectorDB setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "VectorDB setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}