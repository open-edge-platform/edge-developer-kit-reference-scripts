# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

$SCRIPT_DIR = Split-Path -Parent (Resolve-Path $MyInvocation.MyCommand.Path).Path
$FRONTEND_DIR = Split-Path -Parent $SCRIPT_DIR
$NODE_PATH = Join-Path (Split-Path -Parent $FRONTEND_DIR) "thirdparty\node"

$global:OLD_PATH = $null

function Setup-NodeEnv {
    $global:OLD_PATH = $env:PATH
    
    if (Test-Path $NODE_PATH) {
        Write-Host " Setting up Node.js from thirdparty..."
        $env:PATH = "$NODE_PATH;$env:PATH"
    } else {
        Write-Host " thirdparty/node not found. Checking system PATH..."
    }
    
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
    if ($global:OLD_PATH) {
        Write-Host "Resetting environment variables..."
        $env:PATH = $global:OLD_PATH
    }
}

function Ensure-EnvFile {
    Write-Host " Checking for .env.example and .env..."
    if (-not (Test-Path ".env.example")) {
        Write-Host "Error: .env.example not found. Please provide this file." -ForegroundColor Red
        exit 1
    }
    
    if (-not (Test-Path ".env")) {
        Write-Host " Creating .env from .env.example..."
        Copy-Item ".env.example" -Destination ".env"
        Write-Host " .env created."
    }
    else {
        Write-Host " .env already exists."
    }

    # Generate new secret (32 bytes / 64 hex chars)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $PAYLOAD_SECRET = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    
    $content = Get-Content ".env"
    $pattern = "^PAYLOAD_SECRET="
    if ($content -match $pattern) {
        $content = $content -replace "^PAYLOAD_SECRET=.*", "PAYLOAD_SECRET=$PAYLOAD_SECRET"
    } else {
        $content += "PAYLOAD_SECRET=$PAYLOAD_SECRET"
    }
    Set-Content -Path ".env" -Value $content
    Write-Host " PAYLOAD_SECRET updated in .env."
}

function Start-Test {
    Write-Host " Starting tests..."
    Setup-NodeEnv
    try {
        npx playwright install chrome
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        npm run tests
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host " Tests completed."
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
    
    Push-Location $FRONTEND_DIR
    try {
        if ($Action -eq "clean") {
            Clean-Frontend
            return
        }
        Write-Host "Starting frontend setup..."
        Install-Dependencies
        Ensure-EnvFile
        Start-Test
        Write-Host "Frontend setup completed successfully."
    }
    finally {
        Pop-Location
    }
}

Main -Action $args[0]