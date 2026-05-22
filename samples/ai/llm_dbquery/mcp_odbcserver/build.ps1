# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build script for Odbcserver MCP Server

Write-Host "Building Odbcserver MCP Server..." -ForegroundColor Green

# Check if Python is available
try {
    $null = python --version 2>$null
} catch {
    Write-Host "Error: Python is not installed or not found in PATH." -ForegroundColor Red
    exit 1
}

# Set up variables
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = "$ProjectDir\venv"

# Create virtual environment if it doesn't exist
if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvDir
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$VenvDir\Scripts\Activate.ps1"

# Install/upgrade dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install --upgrade pip
pip install -r requirements.txt

# Build the executable
Write-Host "Building executable..." -ForegroundColor Yellow

# Run PyInstaller
Write-Host "Running PyInstaller..." -ForegroundColor Yellow
& python -m PyInstaller odbcserver_server.spec

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "Executable created at: dist\odbcserver-mcp-server.exe" -ForegroundColor Green
    
    # Basic test
    Write-Host "Testing executable..." -ForegroundColor Yellow
    & .\dist\odbcserver-mcp-server.exe version --json
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Executable test passed!" -ForegroundColor Green
    } else {
        Write-Host "Warning: Executable test failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Build process completed." -ForegroundColor Green

Write-Host "Build process completed." -ForegroundColor Green
