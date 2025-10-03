# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit immediately if a command fails
$ErrorActionPreference = "Stop"

# Define variables
$TEMP_DIR = "../build"
$WORKER_DIR = "../workers"
$FRONTEND_DIR = "../frontend"
$ELECTRON_DIR = "../electron"
$NODE_DIR = "../thirdparty/node"

function Add-NodeToPath {
    if (-not (Test-Path $NODE_DIR)) {
        Write-Host "Node.js not found at path: $NODE_DIR" -ForegroundColor Yellow
        return $false
    }
    if (-not $script:nodePathAdded) {
        $script:originalPath = $env:PATH
        $env:PATH = "$NODE_DIR;$env:PATH"
        $script:nodePathAdded = $true
        Write-Host "Temporarily added Node.js to PATH: $NODE_DIR" -ForegroundColor Green
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

function Add-TempDir {
    # Create a temporary directory for worker files
    if (Test-Path $TEMP_DIR) {
        Write-Host "Temporary directory already exists. Cleaning up..."
        Remove-Item -Recurse -Force $TEMP_DIR
    } else {
        Write-Host "Temporary directory does not exist. Creating..."
    }
    New-Item -ItemType Directory -Path $TEMP_DIR | Out-Null
    Write-Host "Temporary directory created at $TEMP_DIR"
}

function Add-WorkerFiles {
    # Copy worker files to the temporary directory
    Write-Host "Copying worker files to temporary directory..."
    New-Item -ItemType Directory -Path "$TEMP_DIR/workers" | Out-Null
    $robocopyResult = robocopy $WORKER_DIR "$TEMP_DIR/workers" /E /XD ".venv" "thirdparty" "__pycache__" "models" "avatars"
    if ($robocopyResult -lt 8) {
        Write-Host "Worker files copied successfully."
    } else {
        Write-Host "Failed to copy worker files. Robocopy exit code: $robocopyResult"
        exit 1
    }
}

function Add-ScriptFiles {
    Write-Host "Copying .ps1 script files to temporary directory..."
    New-Item -ItemType Directory -Path "$TEMP_DIR/scripts" -Force | Out-Null
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $currentScript = $MyInvocation.MyCommand.Path
    $ps1Files = Get-ChildItem -Path $scriptDir -Filter *.ps1 | Where-Object { $_.FullName -ne $currentScript }
    foreach ($file in $ps1Files) {
        Copy-Item $file.FullName "$TEMP_DIR/scripts/" -Force
    }
    Write-Host "Script files copied successfully."
}

function Invoke-FrontendBuild {
    # Build the frontend application
    if (Test-Path $FRONTEND_DIR) {
        Write-Host "Building frontend application..."
        Push-Location $FRONTEND_DIR
        try {
            npm install
            npm run build
            Copy-Item -Recurse ".next/standalone" "$TEMP_DIR/frontend"
            Copy-Item -Recurse ".next/static" "$TEMP_DIR/frontend/.next/static"
        } catch {
            Write-Host "Frontend build failed: $_" -ForegroundColor Red
            exit 1
        }
        Pop-Location
    } else {
        Write-Host "Frontend directory not found. Exiting..." -ForegroundColor Red
        exit 1
    }
}

function Start-ElectronPackage {
    # Package the Electron application
    if (Test-Path $ELECTRON_DIR) {
        Write-Host "Packaging Electron application..."
        Push-Location $ELECTRON_DIR
        try {
            npm run package
        } catch {
            Write-Host "Electron packaging failed."
            exit 1
        }
        Pop-Location
    } else {
        Write-Host "Electron directory not found. Exiting..."
        exit 1
    }
}


try {
    Add-NodeToPath
    Add-TempDir
    Add-WorkerFiles
    Add-ScriptFiles
    Invoke-FrontendBuild
    Start-ElectronPackage

    # Check the size of the build folder
    Write-Host "Checking the size of the build folder..."
    try {
        $buildSize = (Get-ChildItem -Recurse $TEMP_DIR | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "Build folder size: $buildSize MB"
    } catch {
        Write-Host "Failed to calculate the build folder size."
    }

    
    # Final message
    Write-Host "Packaging completed successfully. Files are available in $TEMP_DIR"
} catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clean up Node.js PATH if it was modified
    Remove-NodeFromPath
}
