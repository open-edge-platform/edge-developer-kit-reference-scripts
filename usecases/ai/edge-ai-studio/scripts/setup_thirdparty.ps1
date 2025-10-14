# Exit on error
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'

# Get script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Set thirdparty directory (allow override by first argument)
$THIRDPARTY_DIR = if ($args.Count -ge 1) { $args[0] } else { Join-Path $SCRIPT_DIR '..\thirdparty' }
$NODE_ZIP_PATH = Join-Path $THIRDPARTY_DIR 'node.tar.xz'
$NODE_URL =  "https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip"
$NODE_DIR = Join-Path $THIRDPARTY_DIR 'node'
$NODE_PATH = Join-Path $NODE_DIR 'node.exe'

$GIT_URL = "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.2/MinGit-2.51.0.2-64-bit.zip"
$GIT_DIR = Join-Path $THIRDPARTY_DIR 'git'
$GIT_PATH = Join-Path $GIT_DIR 'cmd\git.exe'

function Setup-Thirdparty {
    Write-Host "Creating thirdparty directory at $THIRDPARTY_DIR..."
    New-Item -ItemType Directory -Force -Path $THIRDPARTY_DIR | Out-Null
    Install-Node
    Install-Git
}

function Install-Git {
     Write-Host "Setting up Git..."
    if (Test-Path $GIT_PATH) {
        Write-Host "Git already exists in thirdparty directory."
        return $GIT_PATH
    }

    # Ensure thirdparty directory exists
    if (-not (Test-Path $THIRDPARTY_DIR)) {
        New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
        Write-Host "Created thirdparty directory."
    }

    if (Test-Path $GIT_DIR) {
        Remove-Item $GIT_DIR -Recurse -Force
    }
    New-Item -ItemType Directory -Path $GIT_DIR -Force | Out-Null

    $fileName = "git.zip"
    $downloadPath = Join-Path $GIT_DIR $fileName

    try {
        Write-Host "Downloading Git from $GIT_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $GIT_URL -OutFile $downloadPath -UseBasicParsing
        Write-Host "Git downloaded successfully."

        Write-Host "Extracting Git ..."
        Expand-Archive -Path $downloadPath -DestinationPath $GIT_DIR -Force

        # Clean up downloaded archive
        Remove-Item $downloadPath -Force
        Write-Host "Cleaned up downloaded archive."

          # Verify installation
        if (Test-Path $GIT_PATH) {
            Write-Host "Git installation completed successfully!"
            return $GIT_PATH
        } else {
            throw "Git executable not found at $GIT_PATH"
        }
    } catch {
        Write-Host "Failed to download or extract Git: $($_.Exception.Message)"
        throw
    }
}

function Install-Node {
    Write-Host "Setting up Node.js..."
    if (Test-Path $NODE_PATH) {
        Write-Host "Node.js already exists in thirdparty directory."
        return $NODE_PATH
    }

    # Ensure thirdparty directory exists
    if (-not (Test-Path $THIRDPARTY_DIR)) {
        New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
        Write-Host "Created thirdparty directory."
    }

    $fileName = "node-v22.18.0-win-x64.zip"
    $extractedFolder = "node-v22.18.0-win-x64"
    $downloadPath = Join-Path $THIRDPARTY_DIR $fileName

    try {
        Write-Host "Downloading Node.js from $NODE_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $NODE_URL -OutFile $downloadPath -UseBasicParsing
        Write-Host "Node.js downloaded successfully."

        Write-Host "Extracting Node.js ..."
        Expand-Archive -Path $downloadPath -DestinationPath $THIRDPARTY_DIR -Force

        # Move extracted folder to 'node' directory
        $extractedPath = Join-Path $THIRDPARTY_DIR $extractedFolder
        if (Test-Path $extractedPath) {
            if (Test-Path $NODE_DIR) {
                Remove-Item $NODE_DIR -Recurse -Force
            }
            Move-Item $extractedPath $NODE_DIR
            Write-Host "Node.js extracted and moved to thirdparty/node."
        } else {
            throw "Extracted Node.js folder not found at $extractedPath"
        }

        # Clean up downloaded archive
        Remove-Item $downloadPath -Force
        Write-Host "Cleaned up downloaded archive."

        # Verify installation
        if (Test-Path $NODE_PATH) {
            Write-Host "Node.js installation completed successfully!"
            return $NODE_PATH
        } else {
            throw "Node.js executable not found at $NODE_PATH"
        }
    } catch {
        Write-Host "Failed to download or extract Node.js: $($_.Exception.Message)"
        throw
    }
}

Setup-Thirdparty
