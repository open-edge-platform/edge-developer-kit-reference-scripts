# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

$ScriptDir = $SCRIPT_DIR
# malaya and malaya_speech are vendored here (pinned in workers\oep-services.json)
# because no release has the VITS code the worker uses.
Invoke-OepFetch services/text-to-speech/malaya
Start-Worker @args
exit $LASTEXITCODE
