# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"
$RootDir = Split-Path $WorkersDir -Parent
$RootThirdPartyDir = Join-Path $RootDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$FFmpegPath = Join-Path $RootThirdPartyDir "ffmpeg\bin\ffmpeg.exe"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-FFmpeg {
    if (Test-Path $FFmpegPath) {
        Write-Host "Found FFmpeg."
        return
    }
    Write-Host "ERROR: FFmpeg not found at $FFmpegPath" -ForegroundColor Red
    Write-Host "Please run the main setup script first." -ForegroundColor Red
    exit 1
}

Push-Location $ScriptDir
try {
    Write-Host "Starting Speech-to-Text setup..." -ForegroundColor Cyan
    Test-UV
    Test-FFmpeg
    Write-Host "Speech-to-Text setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Speech-to-Text setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}