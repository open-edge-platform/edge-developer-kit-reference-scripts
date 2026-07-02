# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\thirdparty\uv\uv.exe"
$RootThirdPartyDir = Join-Path (Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent) "thirdparty"
$GitPath = Join-Path $RootThirdPartyDir "git\cmd\git.exe"
$WAV2LIP_DIR = Join-Path $SCRIPT_DIR "modules\lipsync\wav2lip\wav2lip256"

function Test-UV {
    if (Test-Path $UV_CMD) { return }
    Write-Host "ERROR: uv not found at $UV_CMD" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Get-GitCmd {
    if (Test-Path $GitPath) { return $GitPath }
    if (Get-Command git -ErrorAction SilentlyContinue) { return "git" }
    Write-Host "ERROR: git not found. Please run the main setup script first." -ForegroundColor Red
    exit 1
}

function Ensure-Wav2Lip {
    if ((Test-Path $WAV2LIP_DIR) -and (Get-ChildItem $WAV2LIP_DIR -Force -ErrorAction SilentlyContinue).Count -gt 0) {
        Write-Host "Wav2Lip already set up. Skipping."
        return
    }
    Write-Host "Setting up Wav2Lip..."
    $GitCmd = Get-GitCmd
    $TmpDir = Join-Path $SCRIPT_DIR "tmp\Wav2Lip"
    if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
    & $GitCmd clone https://github.com/Rudrabha/Wav2Lip $TmpDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to clone Wav2Lip (exit code $LASTEXITCODE)" }
    Push-Location $TmpDir
    try {
        & $GitCmd checkout bac9a81e63ecc153202353372e5724b83d9e6322
        if ($LASTEXITCODE -ne 0) { throw "Failed to checkout Wav2Lip commit" }
        & $GitCmd apply "$SCRIPT_DIR\patches\0001-Patch-to-support-256x256-and-xPU.patch"
        if ($LASTEXITCODE -ne 0) { throw "Failed to apply Wav2Lip patch" }
    } finally {
        Pop-Location
    }
    if (Test-Path $WAV2LIP_DIR) { Remove-Item $WAV2LIP_DIR -Recurse -Force }
    New-Item -ItemType Directory -Path $WAV2LIP_DIR -Force | Out-Null
    Copy-Item -Recurse -Path "$TmpDir\face_detection" -Destination "$WAV2LIP_DIR\face_detection"
    Copy-Item -Recurse -Path "$TmpDir\models" -Destination "$WAV2LIP_DIR\"
    Copy-Item -Path "$TmpDir\audio.py" -Destination "$WAV2LIP_DIR\audio.py"
    Copy-Item -Path "$TmpDir\hparams.py" -Destination "$WAV2LIP_DIR\hparams.py"
    Remove-Item -Path (Join-Path $SCRIPT_DIR "tmp") -Recurse -Force
    Write-Host "Wav2Lip set up successfully."
}

Set-Location $SCRIPT_DIR
Test-UV
Ensure-Wav2Lip
& $UV_CMD run main.py @args
exit $LASTEXITCODE
