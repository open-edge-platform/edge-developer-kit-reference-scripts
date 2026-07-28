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

Set-Location $ScriptDir
Test-UV
& $UvCmd run main.py @args