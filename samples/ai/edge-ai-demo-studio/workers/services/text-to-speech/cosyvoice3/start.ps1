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
# cosyvoice and matcha (Matcha-TTS) are vendored here (pinned in workers\upstream.json):
# upstream publishes no package.
Invoke-UpstreamFetch services/text-to-speech/cosyvoice3
Start-Worker @args
exit $LASTEXITCODE
