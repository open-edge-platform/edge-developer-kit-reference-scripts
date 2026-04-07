# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

$ProgressPreference = 'SilentlyContinue'

$SCRIPT_DIR = $PSScriptRoot
$PARENT_THIRDPARTY_DIR = "$SCRIPT_DIR\..\thirdparty"
$PARENT_UV_PATH = "$PARENT_THIRDPARTY_DIR\uv\uv.exe"
$ROOT_THIRDPARTY_DIR = "$SCRIPT_DIR\..\..\thirdparty"
$PARENT_GIT_PATH = "$ROOT_THIRDPARTY_DIR\git\cmd\git.exe"
$UV_CMD = $PARENT_UV_PATH

Write-Host "Setup Digital Avatar Environment" -ForegroundColor Green

function Setup-Environment {
    Write-Host "Setup Virtual Environment" -ForegroundColor Green
    Write-Host "Remove existing venv if exists" -ForegroundColor Yellow
    if (Test-Path .venv) {
        Remove-Item -Path .venv -Recurse -Force -ErrorAction Stop
    }

    Write-Host "Create 3.11.9 venv environment" -ForegroundColor Green
    & $UV_CMD venv --python=3.11.9
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create virtual environment. uv venv exited with code $LASTEXITCODE"
    }
    .venv\Scripts\activate
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to activate virtual environment. Activation exited with code $LASTEXITCODE"
    }
}

function Install-PyTorch {
    Set-Location -Path $SCRIPT_DIR
    Write-Host "Installing PyTorch for xPU" -ForegroundColor Green
    & $UV_CMD pip install -U pip
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip. uv pip install exited with code $LASTEXITCODE"
    }
    & $UV_CMD pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install PyTorch. uv pip install exited with code $LASTEXITCODE"
    }
    & $UV_CMD pip install huggingface-hub[cli]
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install huggingface-hub. uv pip install exited with code $LASTEXITCODE"
    }
}

function Install-Wav2LipDependencies {
    Write-Host "Installing Wav2Lip dependencies" -ForegroundColor Green

    # Clean up existing tmp directory
    if (Test-Path "$SCRIPT_DIR\tmp\Wav2Lip") {
        Remove-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip" -Recurse -Force -ErrorAction Stop
    }
    
    # Create tmp directory if it doesn't exist
    if (-not (Test-Path "$SCRIPT_DIR\tmp")) {
        New-Item -ItemType Directory -Path "$SCRIPT_DIR\tmp" -Force -ErrorAction Stop | Out-Null
    }

    if (-not (Test-Path "$PARENT_GIT_PATH")) {
        Write-Host "Portable git is not found in thirdparty folder, ensure setup script is ran properly" -ForegroundColor Red
        throw "Git not found at $PARENT_GIT_PATH"
    }

    # Clone and patch Wav2Lip
    & $PARENT_GIT_PATH clone https://github.com/Rudrabha/Wav2Lip "$SCRIPT_DIR\tmp\Wav2Lip"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to clone Wav2Lip repository. git clone exited with code $LASTEXITCODE"
    }
    Set-Location -Path "$SCRIPT_DIR\tmp\Wav2Lip" -ErrorAction Stop
    & $PARENT_GIT_PATH checkout bac9a81e63ecc153202353372e5724b83d9e6322
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to checkout Wav2Lip commit. git checkout exited with code $LASTEXITCODE"
    }
    & $PARENT_GIT_PATH apply "$SCRIPT_DIR\patches\0001-Patch-to-support-256x256-and-xPU.patch"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply Wav2Lip patch. git apply exited with code $LASTEXITCODE"
    }

    Set-Location -Path $SCRIPT_DIR -ErrorAction Stop
    
    # Clean up existing wav2lip256 directory
    if (Test-Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256") {
        Remove-Item -Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256" -Recurse -Force -ErrorAction Stop
    }
    
    # Create directory structure
    New-Item -ItemType Directory -Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256" -Force -ErrorAction Stop | Out-Null
    
    # Copy required files
    Copy-Item -Recurse -Path "$SCRIPT_DIR\tmp\Wav2Lip\face_detection" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\face_detection" -ErrorAction Stop
    Copy-Item -Recurse -Path "$SCRIPT_DIR\tmp\Wav2Lip\models" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\" -ErrorAction Stop
    Copy-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip\audio.py" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\audio.py" -ErrorAction Stop
    Copy-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip\hparams.py" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\hparams.py" -ErrorAction Stop

    # Clean up tmp directory
    Remove-Item -Path "$SCRIPT_DIR\tmp" -Recurse -Force -ErrorAction Stop
}

function Install-MainDependencies {
    Write-Host "Install Digital Avatar Dependencies" -ForegroundColor Green
    Set-Location -Path $SCRIPT_DIR
    & $UV_CMD sync
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to sync dependencies. uv sync exited with code $LASTEXITCODE"
    }
}

# Main execution with error handling
try {
    Write-Host "Starting Lipsync Setup..." -ForegroundColor Green
    Push-Location -Path $SCRIPT_DIR
    
    Setup-Environment
    Install-PyTorch
    Install-MainDependencies
    Install-Wav2LipDependencies
    
    Write-Host "Lipsync setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Lipsync setup failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ScriptStackTrace) {
        Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
    }
    exit 1
} finally {
    Pop-Location
}
