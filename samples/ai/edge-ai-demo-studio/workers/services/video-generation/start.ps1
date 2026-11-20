# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Set-Location $ScriptDir
Test-UV
# Every video is encoded to H.264 MP4 with it.
Test-FFmpeg
Start-Worker @args
exit $LASTEXITCODE
