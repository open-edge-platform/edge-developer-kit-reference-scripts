# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\thirdparty\uv\uv.exe"

Set-Location $SCRIPT_DIR
& $UV_CMD run main.py @args
exit $LASTEXITCODE
