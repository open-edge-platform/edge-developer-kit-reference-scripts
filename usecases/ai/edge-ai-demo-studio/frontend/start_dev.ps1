# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE_PATH = Join-Path (Split-Path -Parent $SCRIPT_DIR) "thirdparty\node"

$global:OLD_PATH = $null

function Setup-NodeEnv {
    $global:OLD_PATH = $env:PATH
    Write-Host " Setting up Node.js environment..."
    if (-not (Test-Path $NODE_PATH)) {
        Write-Host "Error: Node.js not found in $NODE_PATH. Please run setup.ps1 in the project root first." -ForegroundColor Red
        exit 1
    }
    $env:PATH = "$NODE_PATH;$env:PATH"
    
    # Check for node and npm
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "Error: node is not available in PATH." -ForegroundColor Red
        exit 1
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npm is not available in PATH." -ForegroundColor Red
        exit 1
    }
    Write-Host " Node.js version: $(node -v)"
    Write-Host " npm version: $(npm -v)"
}

function Reset-Env {
    Write-Host "Resetting environment variables..."
    if ($global:OLD_PATH) {
        $env:PATH = $global:OLD_PATH
    }
}

function Start-DevServer {
    Write-Host " Starting development server..."
    Setup-NodeEnv
    try {
        npm run dev
        Write-Host " Development server started."
    }
    finally {
        Reset-Env
    }
}

function Install-Dependencies {
    Write-Host " Setting up frontend dependencies..."
    Setup-NodeEnv
    try {
        npm install
        Write-Host " Frontend dependencies installed."
    }
    finally {
        Reset-Env
    }
}

function Clean-Frontend {
    Write-Host " Cleaning node_modules and build artifacts..."
    Remove-Item -Path "node_modules", ".next", "dist" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host " Clean complete."
}

function Main {
    param([string]$Action)
    
    Set-Location $SCRIPT_DIR
    
    if ($Action -eq "clean") {
        Clean-Frontend
        exit 0
    }
    if ($Action -eq "install") {
        Install-Dependencies
        exit 0
    }
    Write-Host "Starting frontend setup..."
    Start-DevServer
    Write-Host "Frontend setup completed successfully."
}

Main -Action $args[0]
