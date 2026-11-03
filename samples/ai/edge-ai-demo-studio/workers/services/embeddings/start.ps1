# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Start the embeddings worker: the OEP multimodal-embedding-serving microservice, at the tag
# pinned in workers\oep-services.json (the Text Embedding service's "worker" engine).

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Test-UV
Invoke-OepFetch services/embeddings

Start-OepWorker @args
exit $LASTEXITCODE
