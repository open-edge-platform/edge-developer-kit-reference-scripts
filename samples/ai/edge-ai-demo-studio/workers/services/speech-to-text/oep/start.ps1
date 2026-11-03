# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Start the speech-to-text worker: the OEP audio-analyzer microservice, fetched at the tag
# pinned in workers\oep-services.json and run unmodified.

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Test-UV

# Upstream chunks and probes audio with ffmpeg/ffprobe found on PATH. Prefer
# the copy the project-root setup installs, then whatever the system has.
if (Test-Path $FfmpegPath) {
    $env:PATH = "$(Join-Path $FfmpegDir 'bin');$env:PATH"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ffmpeg/ffprobe not found. Run the project-root setup.ps1 first." -ForegroundColor Red
    exit 1
}

Invoke-OepFetch services/speech-to-text/oep

Start-OepWorker @args
exit $LASTEXITCODE
