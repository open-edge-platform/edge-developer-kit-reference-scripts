# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [string]$ErrorActionPreference = "Stop"
)

# Global variables to track PATH changes
$script:originalPath = $null
$script:nodePathAdded = $false

function Add-FrontendEnv() {
    # Ensure .env is created based on .env.example in frontend
    $envPath = Join-Path $PSScriptRoot ".env"
    $envExamplePath = Join-Path $PSScriptRoot ".env.example"
    if (-not (Test-Path $envPath)) {
        if (Test-Path $envExamplePath) {
            Copy-Item $envExamplePath $envPath
            # Generate a random 32-byte hex string for PAYLOAD_SECRET
            $payloadSecret = [System.BitConverter]::ToString((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) -replace '-', ''
            Add-Content $envPath "PAYLOAD_SECRET=$payloadSecret"
            Write-Host ".env created and PAYLOAD_SECRET added." -ForegroundColor Green
        } else {
            Write-Host ".env.example not found. Skipping .env creation." -ForegroundColor Yellow
        }
    }
}

function Add-NodeToPath {
    param([string]$NodeBinPath)
    
    if (-not $script:nodePathAdded -and (Test-Path $NodeBinPath)) {
        $script:originalPath = $env:PATH
        $env:PATH = "$NodeBinPath;$env:PATH"
        $script:nodePathAdded = $true
        Write-Host "Temporarily added Node.js to PATH: $NodeBinPath" -ForegroundColor Green
        return $true
    }
    return $false
}

function Remove-NodeFromPath {
    if ($script:nodePathAdded -and $script:originalPath) {
        $env:PATH = $script:originalPath
        $script:nodePathAdded = $false
        Write-Host "Restored original PATH" -ForegroundColor Green
    }
}

function Get-NodePaths {
    # Get the root directory (parent of frontend)
    $rootDir = Split-Path $PWD -Parent
    $nodeDir = Join-Path $rootDir "thirdparty\node"
    $nodeExecutable = Join-Path $nodeDir "node.exe"
    
    return @{
        NodeDir = $nodeDir
        NodeExecutable = $nodeExecutable
    }
}

function Test-NodeInstalled {
    Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
    
    $nodePaths = Get-NodePaths
    
    if (Test-Path $nodePaths.NodeExecutable) {
        Write-Host "Using Node.js from: $($nodePaths.NodeExecutable)" -ForegroundColor Green
        try {
            & $nodePaths.NodeExecutable --version | Out-Null
            Write-Host "Node.js is ready to use." -ForegroundColor Green
            
            # Add Node.js to PATH for easier npm usage
            Add-NodeToPath -NodeBinPath $nodePaths.NodeDir | Out-Null
            return $true
        } catch {
            Write-Host "ERROR: Node.js executable is not working properly." -ForegroundColor Red
            throw "Node.js executable test failed"
        }
    } else {
        Write-Host "Node.js not found in thirdparty directory. Checking system PATH..." -ForegroundColor Yellow
        try {
            node --version | Out-Null
            Write-Host "Node.js is installed in system PATH." -ForegroundColor Green
            return $true
        } catch {
            Write-Host "ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
            Write-Host "Please run the root setup.ps1 first to install Node.js, or install Node.js manually:" -ForegroundColor Yellow
            Write-Host "  - Download from: https://nodejs.org/en/download" -ForegroundColor White
            Read-Host "Press Enter to continue..."
            exit 1
        }
    }
}

function Install-Dependencies {
    Write-Host "Installing Frontend node dependencies..." -ForegroundColor Yellow
    try {
        npm install
        Write-Host "Frontend node dependencies installed successfully." -ForegroundColor Green
    } catch {
        Write-Host "Failed to install Frontend node dependencies." -ForegroundColor Red
        throw
    }
}

function Build-Frontend {
    Write-Host "Building the frontend..." -ForegroundColor Yellow
    try {
        npm run build
        Write-Host "Frontend built successfully." -ForegroundColor Green
    } catch {
        Write-Host "Failed to build the frontend." -ForegroundColor Red
        throw
    }
}

# Main execution
try {
    Write-Host "Starting setup..." -ForegroundColor Green
    Add-FrontendEnv
    Test-NodeInstalled
    Install-Dependencies
    Build-Frontend
    Write-Host "Setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
} finally {
    # Always restore the original PATH
    Remove-NodeFromPath
}