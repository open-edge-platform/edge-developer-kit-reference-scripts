# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"
$RootDir = Split-Path $WorkersDir -Parent
$RootThirdPartyDir = Join-Path $RootDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$FFmpegPath = Join-Path $RootThirdPartyDir "ffmpeg\bin\ffmpeg.exe"

$OvmsVersion = "v2025.4.1"
$OptimumVenvDir = Join-Path $ScriptDir "thirdparty\.venv"
$OptimumExportModelUrl = "https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/$OvmsVersion/demos/common/export_models"
$OptimumExportModelRequirements = "requirements.txt"
$OptimumExportModelScript = "export_model.py"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-FFmpeg {
    if (Test-Path $FFmpegPath) {
        Write-Host "Found FFmpeg."
        return
    }
    Write-Host "ERROR: FFmpeg not found at $FFmpegPath" -ForegroundColor Red
    Write-Host "Please run the main setup script first." -ForegroundColor Red
    exit 1
}

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

    if (Test-Path $OptimumVenvDir) {
        Write-Host "Optimum venv already exists at $OptimumVenvDir. Skipping."
        return
    }

    $ThirdPartyDir = Join-Path $ScriptDir "thirdparty"
    New-Item -ItemType Directory -Path $ThirdPartyDir -Force | Out-Null

    Write-Host "Creating Optimum venv at $OptimumVenvDir..."
    & $UVPath venv $OptimumVenvDir

    Write-Host "Downloading Optimum export model requirements..."
    $RequirementsPath = Join-Path $ThirdPartyDir $OptimumExportModelRequirements
    Invoke-FileDownload "$OptimumExportModelUrl/$OptimumExportModelRequirements" `
        $RequirementsPath "Optimum Export Model requirements"

    Write-Host "Downloading Optimum export model script..."
    $ScriptPath = Join-Path $ThirdPartyDir $OptimumExportModelScript
    Invoke-FileDownload "$OptimumExportModelUrl/$OptimumExportModelScript" `
        $ScriptPath "Optimum export model script"

    Write-Host "Installing Optimum export model dependencies into venv..."
    & $UVPath pip install --python $OptimumVenvDir --prerelease allow --index-strategy unsafe-best-match -r $RequirementsPath

    Write-Host "Optimum venv setup completed."
}

Push-Location $ScriptDir
try {
    Write-Host "Starting Speech-to-Text setup..." -ForegroundColor Cyan
    Test-UV
    Test-FFmpeg
    Install-OptimumVenv
    Write-Host "Speech-to-Text setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Speech-to-Text setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}