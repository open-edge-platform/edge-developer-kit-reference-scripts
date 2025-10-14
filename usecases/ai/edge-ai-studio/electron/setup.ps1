# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit on error
$ErrorActionPreference = "Stop"

# Get the directory of this script
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Node.js path from thirdparty
$NODE_PATH = Join-Path $SCRIPT_DIR "..\thirdparty\node"

# Function to set up Node.js environment
function Setup-NodeEnv {
    Write-Host "Setting up Node.js environment..."
    
    if (-Not (Test-Path $NODE_PATH)) {
        Write-Host "Error: Node.js not found in $NODE_PATH. Please run setup.ps1 in the project root first." -ForegroundColor Red
        exit 1
    }
    
    $env:PATH = "$NODE_PATH;$env:PATH"
    
    # Check for node and npm
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

# Main installation
function Main {
    Push-Location $SCRIPT_DIR
    
    Write-Host "Setting up Electron Builder environment..."
    Setup-NodeEnv
    
    Write-Host "Installing npm dependencies..."
    npm install
    
    Write-Host "Electron Builder setup complete!" -ForegroundColor Green
    Pop-Location
}

Main
