# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Text-to-speech worker for models without a built-in worker: the OEP text-to-speech
# microservice, fetched at the tag pinned in workers\oep-services.json.

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Test-UV
Invoke-OepFetch services/text-to-speech/oep-tts

Start-OepWorker @args
exit $LASTEXITCODE
