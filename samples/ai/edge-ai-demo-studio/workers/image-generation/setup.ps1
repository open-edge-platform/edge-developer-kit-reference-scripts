# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path $ScriptDir -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"
$RootDir = Split-Path $WorkersDir -Parent
$RootThirdPartyDir = Join-Path $RootDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$OvmsPath = Join-Path $WorkersThirdPartyDir "ovms\ovms.exe"
$OvmsDir = Join-Path $WorkersThirdPartyDir "ovms"
$GitPath = Join-Path $RootThirdPartyDir "git\cmd"

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

function Test-OVMS {
    if (Test-Path $OvmsPath) {
        Write-Host "Found OVMS."
        return
    }
    Write-Host "ERROR: OVMS not found at $OvmsPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Add-GitToPath {
    if (Test-Path $GitPath) {
        $script:originalPath = $env:PATH
        $env:PATH = "$GitPath;$env:PATH"
        return
    }
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

function Install-OvmsJinja {
    Write-Host "Installing Jinja2 and MarkupSafe into OVMS python directory..."
    $OvmsPythonDir = Join-Path $OvmsDir "python"
    & $UVPath pip install --target $OvmsPythonDir "Jinja2==3.1.6" "MarkupSafe==3.0.2"
    Write-Host "Jinja2/MarkupSafe installed into OVMS python directory."
}

function Install-OptimumVenv {
    Write-Host "Setting up Optimum venv for ovms --pull..."

    if (Test-Path $OptimumVenvDir) {
        Write-Host "Optimum venv already exists at $OptimumVenvDir. Skipping."
        return
    }

    $ThirdPartyDir = Join-Path $ScriptDir "thirdparty"
    New-Item -ItemType Directory -Path $ThirdPartyDir -Force | Out-Null

    Write-Host "Creating Optimum venv at $OptimumVenvDir..."
    & $UVPath venv $OptimumVenvDir

    Write-Host "Downloading Optimum export model requirements..."
    $ScriptPath = Join-Path $ThirdPartyDir $OptimumExportModelScript
    Invoke-FileDownload "$OptimumExportModelUrl/$OptimumExportModelScript" `
        $ScriptPath "Optimum export model script"
    
    $RequirementsPath = Join-Path $ThirdPartyDir $OptimumExportModelRequirements
    Invoke-FileDownload "$OptimumExportModelUrl/$OptimumExportModelRequirements" `
        $RequirementsPath "Optimum Export Model requirements"

    Write-Host "Installing Optimum export model dependencies into venv..."
    & $UVPath pip install --python $OptimumVenvDir --prerelease allow --index-strategy unsafe-best-match -r $RequirementsPath
    & $UVPath pip install --python $OptimumVenvDir modelscope datasets Jinja2==3.1.6 MarkupSafe==3.0.2

    Write-Host "Optimum venv setup completed."
}

Push-Location $ScriptDir
try {
    Write-Host "Starting Image Generation setup..." -ForegroundColor Cyan
    Test-UV
    Test-OVMS
    Add-GitToPath
    Install-OvmsJinja
    Install-OptimumVenv
    Write-Host "Image Generation setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Image Generation setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    # Restore PATH if it was modified by Add-GitToPath
    if ($script:originalPath) {
        $env:PATH = $script:originalPath
    }
    Pop-Location
}