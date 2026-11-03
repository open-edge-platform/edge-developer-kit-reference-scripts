# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

# Install OVMS and its template dependencies when this service starts.
Initialize-Ovms
Start-Worker @args
exit $LASTEXITCODE
