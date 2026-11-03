# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# With `--db-backend pgvector`, first fetches the OEP document-ingestion microservice (pinned in
# workers\oep-services.json); the default FAISS backend needs nothing extra.

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

# True when this start selects the pgvector backend (flag or environment).
function Test-WantsPgvector {
    param([string[]]$Arguments)
    if ($env:VECTORDB_BACKEND -eq "pgvector") { return $true }
    $prev = ""
    foreach ($arg in $Arguments) {
        if ($prev -eq "--db-backend" -and $arg -eq "pgvector") { return $true }
        if ($arg -eq "--db-backend=pgvector") { return $true }
        $prev = $arg
    }
    return $false
}

Test-UV

if (Test-WantsPgvector -Arguments $args) {
    Invoke-OepFetch services/vectordb
}

Start-Worker @args
exit $LASTEXITCODE
