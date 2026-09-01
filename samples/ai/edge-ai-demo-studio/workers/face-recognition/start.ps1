# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$UvCmd = Join-Path $WorkersDir "thirdparty\uv\uv.exe"
if (-not (Test-Path $UvCmd)) { $UvCmd = "uv" }

if (-not (Test-Path $UvCmd) -and -not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: uv not found." -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Set-Location $ScriptDir
& $UvCmd run main.py @args
