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
# vieneu and vieneu_utils are vendored here (pinned in workers\upstream.json)
# because the vieneu package requires gradio, which the worker does not use.
Invoke-UpstreamFetch services/text-to-speech/vieneu
Start-Worker @args
exit $LASTEXITCODE
