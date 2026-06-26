# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$UvCmd = Join-Path $WorkersDir "thirdparty\uv\uv.exe"

if (-not (Test-Path $UvCmd)) {
    $UvCmd = "uv"
}
Set-Location $ScriptDir
& $UvCmd sync
& $UvCmd pip install transformers==4.56.2
& $UvCmd run main.py @args
