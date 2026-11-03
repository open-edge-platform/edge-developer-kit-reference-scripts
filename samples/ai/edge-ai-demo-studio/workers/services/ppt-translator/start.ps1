# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Test-UV
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "file\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "file\outputs") | Out-Null

Set-Location $ScriptDir
Start-Worker @args
exit $LASTEXITCODE
