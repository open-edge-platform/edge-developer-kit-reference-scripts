# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UvCmd = Join-Path $ScriptDir "..\thirdparty\uv\uv.exe"
$PyprojectFile = Join-Path $ScriptDir "pyproject.toml"
$DeploymentDir = Join-Path $ScriptDir "deployment"

function Test-UV {
    if (Test-Path $UvCmd) { return }
    Write-Host "ERROR: uv not found at $UvCmd" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

Test-UV

if (-not (Test-Path $PyprojectFile)) {
    Write-Host "ERROR: pyproject.toml not found at $PyprojectFile" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $DeploymentDir)) {
    Write-Host ""
    Write-Host "WARNING: Deployment folder not found at $DeploymentDir" -ForegroundColor Yellow
    Write-Host "Please unzip your Geti code deployment ZIP into:" -ForegroundColor Yellow
    Write-Host "  $DeploymentDir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Expected structure:" -ForegroundColor Yellow
    Write-Host "  deployment\" -ForegroundColor Yellow
    Write-Host "  +-- project.json" -ForegroundColor Yellow
    Write-Host "  +-- Classification\" -ForegroundColor Yellow
    Write-Host "      +-- model.json" -ForegroundColor Yellow
    Write-Host "      +-- model\" -ForegroundColor Yellow
    Write-Host "      |   +-- model.xml" -ForegroundColor Yellow
    Write-Host "      |   +-- model.bin" -ForegroundColor Yellow
    Write-Host "      |   +-- config.json" -ForegroundColor Yellow
    Write-Host "      +-- python\" -ForegroundColor Yellow
    Write-Host "          +-- requirements.txt" -ForegroundColor Yellow
}

Set-Location $ScriptDir
& $UvCmd run main.py @args
