# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Test-UV
$env:UV_PATH = $UvCmd
Push-Location $ScriptDir
try {
    Initialize-Ovms
    Sync-Worker
    & $UvCmd run --no-sync app-hybrid.py @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
