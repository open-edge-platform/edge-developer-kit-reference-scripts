# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

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
        Remove-Item -Path .venv -Recurse -Force
    }

    Write-Host "Create 3.11.9 venv environment" -ForegroundColor Green
    & $UV_CMD venv --python=3.11.9
    .venv\Scripts\activate
}

function Install-PyTorch {
    Set-Location -Path $SCRIPT_DIR
    Write-Host "Installing PyTorch for xPU" -ForegroundColor Green
    & $UV_CMD pip install -U pip
    & $UV_CMD pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
    & $UV_CMD pip install huggingface-hub[cli]
}

function Install-Wav2LipDependencies {
    Write-Host "Installing Wav2Lip dependencies" -ForegroundColor Green

    # Clean up existing tmp directory
    if (Test-Path "$SCRIPT_DIR\tmp\Wav2Lip") {
        Remove-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip" -Recurse -Force
    }
    
    # Create tmp directory if it doesn't exist
    if (-not (Test-Path "$SCRIPT_DIR\tmp")) {
        New-Item -ItemType Directory -Path "$SCRIPT_DIR\tmp" -Force
    }

    if (-not (Test-Path "$PARENT_GIT_PATH")) {
        Write-Host "Portable git is not found in thirdparty folder, ensure setup script is ran properly"
        throw "Git not found"
    }

    # Clone and patch Wav2Lip
    & $PARENT_GIT_PATH clone https://github.com/Rudrabha/Wav2Lip "$SCRIPT_DIR\tmp\Wav2Lip"
    Set-Location -Path "$SCRIPT_DIR\tmp\Wav2Lip"
    & $PARENT_GIT_PATH checkout bac9a81e63ecc153202353372e5724b83d9e6322
    & $PARENT_GIT_PATH apply "$SCRIPT_DIR\patches\0001-Patch-to-support-256x256-and-xPU.patch"

    Set-Location -Path $SCRIPT_DIR
    
    # Clean up existing wav2lip256 directory
    if (Test-Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256") {
        Remove-Item -Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256" -Recurse -Force
    }
    
    # Create directory structure
    New-Item -ItemType Directory -Path "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256" -Force
    
    # Copy required files
    Copy-Item -Recurse -Path "$SCRIPT_DIR\tmp\Wav2Lip\face_detection" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\face_detection"
    Copy-Item -Recurse -Path "$SCRIPT_DIR\tmp\Wav2Lip\models" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\"
    Copy-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip\audio.py" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\audio.py"
    Copy-Item -Path "$SCRIPT_DIR\tmp\Wav2Lip\hparams.py" -Destination "$SCRIPT_DIR\modules\lipsync\wav2lip\wav2lip256\hparams.py"

    # Clean up tmp directory
    Remove-Item -Path "$SCRIPT_DIR\tmp" -Recurse -Force

    # Download models
    & $UV_CMD run hf download Kedreamix/Linly-Talker --local-dir models/wav2lip/ --include checkpoints/wav2lipv2.pth
    
    # Run test
    & $UV_CMD run modules/lipsync/wav2lip/wav2lip_avatar_generator.py --video_path data/samples/sample_video_ai.mp4
}

function Install-MainDependencies {
    Write-Host "Install Digital Avatar Dependencies" -ForegroundColor Green
    Set-Location -Path $SCRIPT_DIR
    & $UV_CMD sync
}

# Execute functions in order
Setup-Environment
Install-PyTorch
Install-MainDependencies
Install-Wav2LipDependencies

Set-Location -Path $SCRIPT_DIR
