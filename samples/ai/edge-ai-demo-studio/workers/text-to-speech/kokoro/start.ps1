# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\..\thirdparty\uv\uv.exe"

# Model directory mirrors the path computed in main.py:
#   project_root = workers/text-to-speech/kokoro/../../../  =>  app root
#   model_dir    = <app_root>/models/tts/kokoro
$MODEL_DIR = [System.IO.Path]::GetFullPath((Join-Path $SCRIPT_DIR "..\..\..\models\tts\kokoro"))
New-Item -ItemType Directory -Force -Path $MODEL_DIR | Out-Null

# Extract --source and --device values from forwarded arguments
$SOURCE = "huggingface"
$DEVICE = ""
$ScriptArgs = $args
for ($i = 0; $i -lt $ScriptArgs.Count; $i++) {
    if ($ScriptArgs[$i] -eq "--source" -and ($i + 1) -lt $ScriptArgs.Count) {
        $SOURCE = $ScriptArgs[$i + 1]
    } elseif ($ScriptArgs[$i] -match "^--source=(.+)$") {
        $SOURCE = $Matches[1]
    } elseif ($ScriptArgs[$i] -eq "--device" -and ($i + 1) -lt $ScriptArgs.Count) {
        $DEVICE = $ScriptArgs[$i + 1]
    } elseif ($ScriptArgs[$i] -match "^--device=(.+)$") {
        $DEVICE = $Matches[1]
    }
}

$EXPORT_PYTHON = Join-Path $SCRIPT_DIR ".export-venv\Scripts\python.exe"

if (-not (Test-Path $EXPORT_PYTHON)) {
    Write-Host "ERROR: Export virtual environment not found at $SCRIPT_DIR\.export-venv" -ForegroundColor Red
    Write-Host "Please run setup.ps1 first." -ForegroundColor Red
    exit 1
}

# Export model to OpenVINO IR using the export venv (skipped automatically if already done)
$NPU_FLAGS = @()
if ($DEVICE -eq "NPU") {
    $NPU_FLAGS = @("--npu")
}

Write-Host "Running model export to OpenVINO IR..."
& $EXPORT_PYTHON (Join-Path $SCRIPT_DIR "export.py") --model_dir $MODEL_DIR --source $SOURCE @NPU_FLAGS
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $SCRIPT_DIR
if (-not (Test-Path (Join-Path $SCRIPT_DIR ".venv"))) {
    & $UV_CMD venv --seed
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Build a clean arg list: strip any --device/--device=... the caller passed,
# since we have already resolved the device and will pass it explicitly.
$FILTERED_ARGS = @()
$SkipNext = $false
foreach ($arg in $ScriptArgs) {
    if ($SkipNext) {
        $SkipNext = $false
        continue
    }
    if ($arg -eq "--device") {
        $SkipNext = $true
        continue
    } elseif ($arg -match "^--device=") {
        continue
    }
    $FILTERED_ARGS += $arg
}

$DEVICE_ARGS = @()
if ($DEVICE -ne "") {
    $DEVICE_ARGS = @("--device", $DEVICE)
}

& $UV_CMD run main.py @DEVICE_ARGS @FILTERED_ARGS
exit $LASTEXITCODE
