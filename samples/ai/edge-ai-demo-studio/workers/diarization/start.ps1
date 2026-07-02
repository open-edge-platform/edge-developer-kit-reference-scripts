# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UvCmd = Join-Path $ScriptDir "..\thirdparty\uv\uv.exe"

function Test-UV {
    if (Test-Path $UvCmd) { return }
    Write-Host "ERROR: uv not found at $UvCmd" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "NOTE: This worker requires a HuggingFace token (HF_TOKEN) with accepted" -ForegroundColor Yellow
Write-Host "      license agreements for the following models:" -ForegroundColor Yellow
Write-Host "        - pyannote/embedding" -ForegroundColor Yellow
Write-Host "        - pyannote/speaker-diarization-3.1" -ForegroundColor Yellow
Write-Host "      Visit https://hf.co/pyannote/embedding and https://hf.co/pyannote/speaker-diarization-3.1" -ForegroundColor Yellow
Write-Host "      to accept the license, then set HF_TOKEN=<your_token> in your environment." -ForegroundColor Yellow
Write-Host ""

Set-Location $ScriptDir
Test-UV
& $UvCmd run main.py @args