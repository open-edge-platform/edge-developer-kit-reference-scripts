# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

$NODE_PATH = Join-Path $SCRIPT_DIR "..\thirdparty\node"

$script:originalPath = $env:PATH

function Setup-NodeEnv {
    Write-Host "Setting up Node.js environment..."
    
    if (-Not (Test-Path $NODE_PATH)) {
        Write-Host "Error: Node.js not found in $NODE_PATH. Please run setup.ps1 in the project root first." -ForegroundColor Red
        exit 1
    }
    
    $env:PATH = "$NODE_PATH;$env:PATH"
    
    if (-Not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "Error: node is not available in PATH." -ForegroundColor Red
        exit 1
    }
    
    if (-Not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npm is not available in PATH." -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Node.js version: $(node -v)"
    Write-Host "npm version: $(npm -v)"
}

function Main {
    Push-Location $SCRIPT_DIR
    try {
        Write-Host "Setting up Electron Builder environment..."
        Setup-NodeEnv
        
        Write-Host "Installing npm dependencies..."
        npm install
        # A failing native command does not throw, even under Stop.
        if ($LASTEXITCODE -ne 0) { throw "npm install exited with $LASTEXITCODE" }

        Write-Host "Electron Builder setup complete!" -ForegroundColor Green
    }
    finally {
        if ($script:originalPath) {
            $env:PATH = $script:originalPath
        }
        Pop-Location
    }
}

Main
