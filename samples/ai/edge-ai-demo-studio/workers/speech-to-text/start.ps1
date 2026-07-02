# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\thirdparty\uv\uv.exe"
$ROOT_THIRDPARTY_DIR = Join-Path (Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent) "thirdparty"
$FFMPEG_PATH = Join-Path $ROOT_THIRDPARTY_DIR "ffmpeg\bin\ffmpeg.exe"

function Test-UV {
    if (Test-Path $UV_CMD) { return }
    Write-Host "ERROR: uv not found at $UV_CMD" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-FFmpeg {
    if (Test-Path $FFMPEG_PATH) { return }
    Write-Host "ERROR: FFmpeg not found at $FFMPEG_PATH" -ForegroundColor Red
    Write-Host "Please run the main setup script first." -ForegroundColor Red
    exit 1
}

Test-UV
Test-FFmpeg

$OVMS_VERSION = "v2026.2"
$OPTIMUM_VENV_DIR = Join-Path $SCRIPT_DIR "thirdparty\.venv"
$OPTIMUM_EXPORT_MODEL_URL = "https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/$OVMS_VERSION/demos/common/export_models"
$OPTIMUM_EXPORT_MODEL_REQUIREMENTS = "requirements.txt"
$OPTIMUM_EXPORT_MODEL_SCRIPT = "export_model.py"

function Invoke-FileDownload {
    param(
        [string]$Url,
        [string]$Output,
        [string]$Description = "file"
    )
    Write-Host "Downloading $Description..."
    Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing
    Write-Host "Downloaded $Description."
}

function Install-OptimumVenv {
    Write-Host "Setting up Optimum venv for model export..."

    if (Test-Path $OPTIMUM_VENV_DIR) {
        Write-Host "Optimum venv already exists at $OPTIMUM_VENV_DIR. Skipping."
        return
    }

    $ThirdPartyDir = Join-Path $SCRIPT_DIR "thirdparty"
    New-Item -ItemType Directory -Path $ThirdPartyDir -Force | Out-Null

    Write-Host "Creating Optimum venv at $OPTIMUM_VENV_DIR..."
    & $UV_CMD venv $OPTIMUM_VENV_DIR
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $RequirementsPath = Join-Path $ThirdPartyDir $OPTIMUM_EXPORT_MODEL_REQUIREMENTS
    Invoke-FileDownload "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS" `
        $RequirementsPath "Optimum Export Model requirements"

    $ScriptPath = Join-Path $ThirdPartyDir $OPTIMUM_EXPORT_MODEL_SCRIPT
    Invoke-FileDownload "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_SCRIPT" `
        $ScriptPath "Optimum export model script"

    Write-Host "Installing Optimum export model dependencies into venv..."
    & $UV_CMD pip install --python $OPTIMUM_VENV_DIR --prerelease allow --index-strategy unsafe-best-match -r $RequirementsPath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "Optimum venv setup completed."
}

Set-Location $SCRIPT_DIR
Install-OptimumVenv
& $UV_CMD run main.py @args
exit $LASTEXITCODE
