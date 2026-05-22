# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"
$RootDir = Split-Path $WorkersDir -Parent
$RootThirdPartyDir = Join-Path $RootDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$GitPath = Join-Path $RootThirdPartyDir "git\cmd\git.exe"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-Git {
    if (Test-Path $GitPath) {
        return
    }
    Write-Host "ERROR: Portable git not found at $GitPath" -ForegroundColor Red
    Write-Host "Please run the main setup script first." -ForegroundColor Red
    exit 1
}

function Install-Wav2LipDependencies {
    Write-Host "Installing Wav2Lip dependencies..."

    if (Test-Path "$ScriptDir\tmp\Wav2Lip") {
        Remove-Item -Path "$ScriptDir\tmp\Wav2Lip" -Recurse -Force
    }

    if (-not (Test-Path "$ScriptDir\tmp")) {
        New-Item -ItemType Directory -Path "$ScriptDir\tmp" -Force | Out-Null
    }

    & $GitPath clone https://github.com/Rudrabha/Wav2Lip "$ScriptDir\tmp\Wav2Lip"
    if ($LASTEXITCODE -ne 0) { throw "Failed to clone Wav2Lip (exit code $LASTEXITCODE)" }

    Set-Location "$ScriptDir\tmp\Wav2Lip"
    & $GitPath checkout bac9a81e63ecc153202353372e5724b83d9e6322
    if ($LASTEXITCODE -ne 0) { throw "Failed to checkout Wav2Lip commit (exit code $LASTEXITCODE)" }

    & $GitPath apply "$ScriptDir\patches\0001-Patch-to-support-256x256-and-xPU.patch"
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply Wav2Lip patch (exit code $LASTEXITCODE)" }

    Set-Location $ScriptDir

    if (Test-Path "$ScriptDir\modules\lipsync\wav2lip\wav2lip256") {
        Remove-Item -Path "$ScriptDir\modules\lipsync\wav2lip\wav2lip256" -Recurse -Force
    }

    New-Item -ItemType Directory -Path "$ScriptDir\modules\lipsync\wav2lip\wav2lip256" -Force | Out-Null

    Copy-Item -Recurse -Path "$ScriptDir\tmp\Wav2Lip\face_detection" -Destination "$ScriptDir\modules\lipsync\wav2lip\wav2lip256\face_detection"
    Copy-Item -Recurse -Path "$ScriptDir\tmp\Wav2Lip\models" -Destination "$ScriptDir\modules\lipsync\wav2lip\wav2lip256\"
    Copy-Item -Path "$ScriptDir\tmp\Wav2Lip\audio.py" -Destination "$ScriptDir\modules\lipsync\wav2lip\wav2lip256\audio.py"
    Copy-Item -Path "$ScriptDir\tmp\Wav2Lip\hparams.py" -Destination "$ScriptDir\modules\lipsync\wav2lip\wav2lip256\hparams.py"

    Remove-Item -Path "$ScriptDir\tmp" -Recurse -Force
    Write-Host "Wav2Lip dependencies installed."
}

Push-Location $ScriptDir
try {
    Write-Host "Starting Lipsync setup..." -ForegroundColor Cyan
    Test-UV
    Test-Git
    Install-Wav2LipDependencies
    Write-Host "Lipsync setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Lipsync setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
