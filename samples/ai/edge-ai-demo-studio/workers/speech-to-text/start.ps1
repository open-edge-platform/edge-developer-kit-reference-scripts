# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\thirdparty\uv\uv.exe"
$ROOT_THIRDPARTY_DIR = Join-Path (Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent) "thirdparty"
$FFMPEG_PATH = Join-Path $ROOT_THIRDPARTY_DIR "ffmpeg\bin\ffmpeg.exe"

$WORKERS_DIR = Split-Path $SCRIPT_DIR -Parent
$WORKERS_THIRDPARTY_DIR = Join-Path $WORKERS_DIR "thirdparty"
$OVMS_DIR = Join-Path $WORKERS_THIRDPARTY_DIR "ovms"
$OVMS_PATH = Join-Path $WORKERS_THIRDPARTY_DIR "ovms\ovms.exe"

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

function Test-OVMS {
    if (Test-Path $OVMS_PATH) { return }
    Write-Host "ERROR: OVMS not found at $OVMS_PATH" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Test-UV
Test-FFmpeg
Test-OVMS

$OVMS_VERSION = "v2026.3"
$OPTIMUM_VENV_DIR = Join-Path $SCRIPT_DIR "thirdparty\.venv"
$OPTIMUM_VENV_PROFILE_FILE = Join-Path $SCRIPT_DIR "thirdparty\.venv-profile"
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

function Install-OvmsJinja {
    $OvmsPythonDir = Join-Path $OVMS_DIR "python"
    if (Test-Path (Join-Path $OvmsPythonDir "jinja2")) {
        Write-Host "Jinja2 already installed in OVMS python directory. Skipping."
        return
    }
    Write-Host "Installing Jinja2 and MarkupSafe into OVMS python directory..."
    & $UV_CMD pip install --target $OvmsPythonDir "Jinja2==3.1.6" "MarkupSafe==3.0.2"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Jinja2/MarkupSafe installed into OVMS python directory."
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
    & $UV_CMD pip install --python $OPTIMUM_VENV_DIR modelscope datasets Jinja2==3.1.6 MarkupSafe==3.0.2
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    "base" | Set-Content -Path $OPTIMUM_VENV_PROFILE_FILE -NoNewline

    Write-Host "Optimum venv setup completed."
}

# Swap optimum-intel/transformers in the Optimum venv depending on the selected
# STT model. Qwen3-ASR needs a forked optimum-intel + transformers>=5.13; every
# other model needs the versions pinned in requirements.txt. Tracked via a
# profile marker file so we only reinstall when the profile actually changes.
function Set-OptimumProfile {
    param([string]$ModelId)

    $DesiredProfile = if ($ModelId -eq "Qwen/Qwen3-ASR-1.7B-hf") { "qwen3" } else { "base" }

    $CurrentProfile = ""
    if (Test-Path $OPTIMUM_VENV_PROFILE_FILE) {
        $CurrentProfile = (Get-Content -Path $OPTIMUM_VENV_PROFILE_FILE -Raw).Trim()
    }

    if ($CurrentProfile -eq $DesiredProfile) {
        Write-Host "Optimum venv already on '$DesiredProfile' profile. Skipping dependency swap."
        return
    }

    $RequirementsPath = Join-Path (Join-Path $SCRIPT_DIR "thirdparty") $OPTIMUM_EXPORT_MODEL_REQUIREMENTS

    if ($DesiredProfile -eq "qwen3") {
        Write-Host "Switching Optimum venv to 'qwen3' profile (forked optimum-intel + transformers 5.13)..."
        & $UV_CMD pip install --python $OPTIMUM_VENV_DIR git+https://github.com/openvino-dev-samples/optimum-intel.git@add-qwen3-asr-hf-and-forced-aligner
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $UV_CMD pip install --python $OPTIMUM_VENV_DIR --pre "transformers>=5.13,<5.14" "safetensors>=0.8.0"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } else {
        Write-Host "Switching Optimum venv to 'base' profile (requirements.txt versions)..."
        & $UV_CMD pip install --python $OPTIMUM_VENV_DIR --prerelease allow --index-strategy unsafe-best-match `
            --reinstall-package optimum-intel --reinstall-package transformers -r $RequirementsPath
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $DesiredProfile | Set-Content -Path $OPTIMUM_VENV_PROFILE_FILE -NoNewline
    Write-Host "Optimum venv now on '$DesiredProfile' profile."
}

function Get-SttModelId {
    param([string[]]$Arguments)

    for ($i = 0; $i -lt $Arguments.Length - 1; $i++) {
        if ($Arguments[$i] -eq "--stt-model-id") {
            return $Arguments[$i + 1]
        }
    }
    return ""
}

Set-Location $SCRIPT_DIR
Install-OvmsJinja
Install-OptimumVenv
$SttModelId = Get-SttModelId -Arguments $args
Set-OptimumProfile -ModelId $SttModelId
& $UV_CMD run main.py @args
exit $LASTEXITCODE
