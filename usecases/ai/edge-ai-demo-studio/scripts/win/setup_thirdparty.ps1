# Exit on error
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Set UTF-8 encoding for console output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Get script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Set thirdparty directory (allow override by first argument)
$THIRDPARTY_DIR = if ($args.Count -ge 1) { $args[0] } else { Join-Path $SCRIPT_DIR '..\..\thirdparty' }
$NODE_ZIP_PATH = Join-Path $THIRDPARTY_DIR 'node.tar.xz'
$NODE_URL =  "https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip"
$NODE_DIR = Join-Path $THIRDPARTY_DIR 'node'
$NODE_PATH = Join-Path $NODE_DIR 'node.exe'

$GIT_URL = "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.2/MinGit-2.51.0.2-64-bit.zip"
$GIT_DIR = Join-Path $THIRDPARTY_DIR 'git'
$GIT_PATH = Join-Path $GIT_DIR 'cmd\git.exe'

$FFMPEG_ZIP_PATH = Join-Path $THIRDPARTY_DIR 'ffmpeg-release-essentials.zip'
$FFMPEG_ZIP_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$FFMPEG_DIR = Join-Path $THIRDPARTY_DIR 'ffmpeg'
$FFMPEG_PATH = Join-Path $FFMPEG_DIR 'bin\ffmpeg.exe'

function Setup-Thirdparty {
    Write-Host "Creating thirdparty directory at $THIRDPARTY_DIR..."
    try {
        New-Item -ItemType Directory -Force -Path $THIRDPARTY_DIR | Out-Null
    } catch {
        Write-Host "ERROR: Failed to create thirdparty directory at $THIRDPARTY_DIR" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
    
    try {
        Install-Node | Out-Null
    } catch {
        Write-Host "ERROR: Node.js installation failed" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
    
    try {
        Install-Git | Out-Null
    } catch {
        Write-Host "ERROR: Git installation failed" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
    
    try {
        Install-FFmpeg | Out-Null
    } catch {
        Write-Host "ERROR: FFmpeg installation failed" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Thirdparty setup completed successfully" -ForegroundColor Green
}

function Install-Git {
    Write-Host "Setting up Git..."
    if (Test-Path $GIT_PATH) {
        Write-Host "Git already installed at $GIT_PATH" -ForegroundColor Green
        return $GIT_PATH
    }

    # Ensure thirdparty directory exists
    if (-not (Test-Path $THIRDPARTY_DIR)) {
        try {
            New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
            Write-Host "Created thirdparty directory."
        } catch {
            Write-Host "ERROR: Failed to create thirdparty directory" -ForegroundColor Red
            throw
        }
    }

    if (Test-Path $GIT_DIR) {
        Remove-Item $GIT_DIR -Recurse -Force
    }
    
    try {
        New-Item -ItemType Directory -Path $GIT_DIR -Force | Out-Null
    } catch {
        Write-Host "ERROR: Failed to create Git directory" -ForegroundColor Red
        throw
    }

    $fileName = "git.zip"
    $downloadPath = Join-Path $GIT_DIR $fileName

    try {
        Write-Host "Downloading Git from $GIT_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $GIT_URL -OutFile $downloadPath -UseBasicParsing -ErrorAction Stop
        Write-Host "Git downloaded successfully."

        Write-Host "Extracting Git ..."
        Expand-Archive -Path $downloadPath -DestinationPath $GIT_DIR -Force -ErrorAction Stop

        # Clean up downloaded archive
        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        # Verify installation
        if (-not (Test-Path $GIT_PATH)) {
            Write-Host "ERROR: Git executable not found at $GIT_PATH after extraction" -ForegroundColor Red
            throw "Git installation verification failed"
        }
        
        # Test if Git works
        $gitVersion = & $GIT_PATH --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Git installation verification failed" -ForegroundColor Red
            throw "Git binary found but not working properly"
        }
        
        Write-Host "Git installed successfully at $GIT_PATH" -ForegroundColor Green
        return $GIT_PATH
    } catch {
        Write-Host "ERROR: Failed to download or extract Git: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        throw
    }
}

function Install-Node {
    Write-Host "Setting up Node.js..."
    if (Test-Path $NODE_PATH) {
        Write-Host "Node.js already installed at $NODE_PATH" -ForegroundColor Green
        return $NODE_PATH
    }

    # Ensure thirdparty directory exists
    if (-not (Test-Path $THIRDPARTY_DIR)) {
        try {
            New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
            Write-Host "Created thirdparty directory."
        } catch {
            Write-Host "ERROR: Failed to create thirdparty directory" -ForegroundColor Red
            throw
        }
    }

    $fileName = "node-v22.18.0-win-x64.zip"
    $extractedFolder = "node-v22.18.0-win-x64"
    $downloadPath = Join-Path $THIRDPARTY_DIR $fileName

    try {
        Write-Host "Downloading Node.js from $NODE_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $NODE_URL -OutFile $downloadPath -UseBasicParsing -ErrorAction Stop
        Write-Host "Node.js downloaded successfully."

        Write-Host "Extracting Node.js ..."
        Expand-Archive -Path $downloadPath -DestinationPath $THIRDPARTY_DIR -Force -ErrorAction Stop

        # Move extracted folder to 'node' directory
        $extractedPath = Join-Path $THIRDPARTY_DIR $extractedFolder
        if (-not (Test-Path $extractedPath)) {
            Write-Host "ERROR: Extracted Node.js folder not found at $extractedPath" -ForegroundColor Red
            throw "Node.js extraction failed"
        }
        
        if (Test-Path $NODE_DIR) {
            Remove-Item $NODE_DIR -Recurse -Force
        }
        Move-Item $extractedPath $NODE_DIR
        Write-Host "Node.js extracted and moved to thirdparty/node."

        # Clean up downloaded archive
        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        # Verify installation
        if (-not (Test-Path $NODE_PATH)) {
            Write-Host "ERROR: Node.js executable not found at $NODE_PATH after extraction" -ForegroundColor Red
            throw "Node.js installation verification failed"
        }
        
        # Test if Node works
        $nodeVersion = & $NODE_PATH --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Node.js installation verification failed" -ForegroundColor Red
            throw "Node.js binary found but not working properly"
        }
        
        Write-Host "Node.js installed successfully at $NODE_PATH" -ForegroundColor Green
        return $NODE_PATH
    } catch {
        Write-Host "ERROR: Failed to download or extract Node.js: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        throw
    }
}

function Install-FFmpeg {
    Write-Host "Setting up FFmpeg..."
    if (Test-Path $FFMPEG_DIR) {
        Write-Host "FFmpeg directory already exists at $FFMPEG_DIR. Skipping download." -ForegroundColor Green
        return $FFMPEG_PATH
    }

    # Ensure thirdparty directory exists
    if (-not (Test-Path $THIRDPARTY_DIR)) {
        try {
            New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
            Write-Host "Created thirdparty directory."
        } catch {
            Write-Host "ERROR: Failed to create thirdparty directory" -ForegroundColor Red
            throw
        }
    }

    try {
        Write-Host "Downloading FFmpeg from $FFMPEG_ZIP_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $FFMPEG_ZIP_URL -OutFile $FFMPEG_ZIP_PATH -UseBasicParsing -ErrorAction Stop
        Write-Host "FFmpeg downloaded successfully."

        Write-Host "Extracting FFmpeg ..."
        Expand-Archive -Path $FFMPEG_ZIP_PATH -DestinationPath $THIRDPARTY_DIR -Force -ErrorAction Stop

        # Find the extracted directory (it usually has a version number)
        $extractedDir = Get-ChildItem -Path $THIRDPARTY_DIR -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1

        if (-not $extractedDir) {
            Write-Host "ERROR: Could not find extracted FFmpeg directory" -ForegroundColor Red
            Remove-Item $FFMPEG_ZIP_PATH -Force -ErrorAction SilentlyContinue
            throw "FFmpeg extraction failed"
        }

        # Rename to simply "ffmpeg"
        if (Test-Path $FFMPEG_DIR) {
            Remove-Item $FFMPEG_DIR -Recurse -Force
        }
        Rename-Item -Path $extractedDir.FullName -NewName "ffmpeg" -ErrorAction Stop

        # Clean up downloaded archive
        Remove-Item $FFMPEG_ZIP_PATH -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        # Verify installation
        if (-not (Test-Path $FFMPEG_PATH)) {
            Write-Host "ERROR: FFmpeg executable not found at $FFMPEG_PATH after extraction" -ForegroundColor Red
            throw "FFmpeg installation verification failed"
        }

        # Test if FFmpeg works
        & $FFMPEG_PATH -version | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: FFmpeg installation verification failed" -ForegroundColor Red
            throw "FFmpeg binary found but not working properly"
        }

        Write-Host "FFmpeg downloaded and extracted successfully." -ForegroundColor Green
        return $FFMPEG_PATH
    } catch {
        Write-Host "ERROR: Failed to download or extract FFmpeg: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        throw
    }
}

Push-Location $SCRIPT_DIR
try {
    Setup-Thirdparty
} finally {
    Pop-Location
}
