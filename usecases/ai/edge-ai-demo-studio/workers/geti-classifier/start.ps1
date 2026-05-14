# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UvCmd = Join-Path $ScriptDir "..\thirdparty\uv\uv.exe"

Set-Location $ScriptDir
& $UvCmd run main.py @args
