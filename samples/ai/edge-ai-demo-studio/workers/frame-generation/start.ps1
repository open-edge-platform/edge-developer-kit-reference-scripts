# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\thirdparty\uv\uv.exe"

function Test-UV {
    if (Test-Path $UV_CMD) { return }
    Write-Host "ERROR: uv not found at $UV_CMD" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Test-UV
Set-Location $SCRIPT_DIR
& $UV_CMD run main.py @args
exit $LASTEXITCODE
