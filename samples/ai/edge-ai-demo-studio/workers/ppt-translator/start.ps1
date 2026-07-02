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

Test-UV
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "file\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "file\outputs") | Out-Null

Set-Location $ScriptDir
& $UvCmd run main.py @args