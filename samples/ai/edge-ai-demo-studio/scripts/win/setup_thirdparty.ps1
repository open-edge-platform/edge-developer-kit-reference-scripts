# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 redraws the progress bar per chunk, which makes
# Invoke-WebRequest and Expand-Archive many times slower, and may default to
# TLS 1.0, which GitHub refuses.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition

$THIRDPARTY_DIR = if ($args.Count -ge 1) { $args[0] } else { Join-Path $SCRIPT_DIR '..\..\thirdparty' }
$NODE_ZIP_PATH = Join-Path $THIRDPARTY_DIR 'node.tar.xz'
$NODE_VERSION = "v24.22.1"
$NODE_FILE_NAME = "node-$NODE_VERSION-win-x64.zip"
$NODE_URL = "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE_NAME"
$NODE_DIR = Join-Path $THIRDPARTY_DIR 'node'
$NODE_PATH = Join-Path $NODE_DIR 'node.exe'

$GIT_URL = "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.2/MinGit-2.51.0.2-64-bit.zip"
$GIT_DIR = Join-Path $THIRDPARTY_DIR 'git'
$GIT_PATH = Join-Path $GIT_DIR 'cmd\git.exe'

$GIT_LFS_URL = "https://github.com/git-lfs/git-lfs/releases/download/v3.7.1/git-lfs-windows-amd64-v3.7.1.zip"
$GIT_LFS_PATH = Join-Path $GIT_DIR 'cmd\git-lfs.exe'

$FFMPEG_ZIP_PATH = Join-Path $THIRDPARTY_DIR 'ffmpeg-win64-gpl.zip'
$FFMPEG_ZIP_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0.zip"
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
        Install-GitLfs | Out-Null
    } catch {
        Write-Host "ERROR: Git LFS installation failed" -ForegroundColor Red
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

        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        if (-not (Test-Path $GIT_PATH)) {
            Write-Host "ERROR: Git executable not found at $GIT_PATH after extraction" -ForegroundColor Red
            throw "Git installation verification failed"
        }
        
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

function Install-GitLfs {
    Write-Host "Setting up Git LFS..."
    if (-not (Test-Path $GIT_PATH)) {
        Write-Host "ERROR: Git must be installed before Git LFS" -ForegroundColor Red
        throw "Git not found at $GIT_PATH"
    }
    if (Test-Path $GIT_LFS_PATH) {
        Write-Host "Git LFS already installed at $GIT_LFS_PATH" -ForegroundColor Green
        return $GIT_LFS_PATH
    }

    $downloadPath = Join-Path $GIT_DIR 'git-lfs.zip'
    $tempExtract = Join-Path $GIT_DIR 'git-lfs-tmp'
    try {
        Write-Host "Downloading Git LFS from $GIT_LFS_URL ..."
        Invoke-WebRequest -Uri $GIT_LFS_URL -OutFile $downloadPath -UseBasicParsing -ErrorAction Stop
        Write-Host "Git LFS downloaded successfully."

        if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
        Write-Host "Extracting Git LFS ..."
        Expand-Archive -Path $downloadPath -DestinationPath $tempExtract -Force -ErrorAction Stop

        $lfsExe = Get-ChildItem -Path $tempExtract -Recurse -Filter 'git-lfs.exe' | Select-Object -First 1
        if (-not $lfsExe) {
            throw "git-lfs.exe not found in downloaded archive"
        }

        # Place git-lfs next to git.exe (cmd\) so it is always found on PATH, and
        # in mingw64\bin so git's internal filter lookup resolves it too.
        Copy-Item $lfsExe.FullName -Destination $GIT_LFS_PATH -Force
        $mingwBin = Join-Path $GIT_DIR 'mingw64\bin'
        if (Test-Path $mingwBin) {
            Copy-Item $lfsExe.FullName -Destination (Join-Path $mingwBin 'git-lfs.exe') -Force
        }

        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        if (-not (Test-Path $GIT_LFS_PATH)) {
            Write-Host "ERROR: Git LFS executable not found at $GIT_LFS_PATH after extraction" -ForegroundColor Red
            throw "Git LFS installation verification failed"
        }

        # Register the LFS filters in the bundled git's system config, for every process using it.
        # --skip-repo: no hooks in the surrounding repository. Continue: under Stop, Windows
        # PowerShell 5.1 throws on redirected stderr.
        & { $ErrorActionPreference = 'Continue'; & $GIT_PATH lfs install --system --skip-repo 2>&1 | Out-Null }

        $lfsVersion = & $GIT_LFS_PATH --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Git LFS installation verification failed" -ForegroundColor Red
            throw "Git LFS binary found but not working properly"
        }

        Write-Host "Git LFS installed successfully at $GIT_LFS_PATH" -ForegroundColor Green
        return $GIT_LFS_PATH
    } catch {
        Write-Host "ERROR: Failed to download or install Git LFS: $($_.Exception.Message)" -ForegroundColor Red
        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        throw
    }
}

function Install-Node {
    Write-Host "Setting up Node.js..."
    if (Test-Path $NODE_PATH) {
        $installedVersion = (& $NODE_PATH --version 2>$null | Out-String).Trim()
        if ($installedVersion -eq $NODE_VERSION) {
            Write-Host "Node.js $NODE_VERSION already installed at $NODE_PATH" -ForegroundColor Green
            return $NODE_PATH
        }
        # The old folder is removed before the new one is moved in, below.
        Write-Host "Replacing Node.js $installedVersion with $NODE_VERSION ..." -ForegroundColor Yellow
    }

    if (-not (Test-Path $THIRDPARTY_DIR)) {
        try {
            New-Item -ItemType Directory -Path $THIRDPARTY_DIR -Force | Out-Null
            Write-Host "Created thirdparty directory."
        } catch {
            Write-Host "ERROR: Failed to create thirdparty directory" -ForegroundColor Red
            throw
        }
    }

    $fileName = $NODE_FILE_NAME
    $extractedFolder = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
    $downloadPath = Join-Path $THIRDPARTY_DIR $fileName

    try {
        Write-Host "Downloading Node.js from $NODE_URL ..."
        Write-Host "This may take a few minutes depending on your internet connection..."
        Invoke-WebRequest -Uri $NODE_URL -OutFile $downloadPath -UseBasicParsing -ErrorAction Stop
        Write-Host "Node.js downloaded successfully."

        Write-Host "Extracting Node.js ..."
        Expand-Archive -Path $downloadPath -DestinationPath $THIRDPARTY_DIR -Force -ErrorAction Stop

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

        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        if (-not (Test-Path $NODE_PATH)) {
            Write-Host "ERROR: Node.js executable not found at $NODE_PATH after extraction" -ForegroundColor Red
            throw "Node.js installation verification failed"
        }
        
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

        $extractedDir = Get-ChildItem -Path $THIRDPARTY_DIR -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1

        if (-not $extractedDir) {
            Write-Host "ERROR: Could not find extracted FFmpeg directory" -ForegroundColor Red
            Remove-Item $FFMPEG_ZIP_PATH -Force -ErrorAction SilentlyContinue
            throw "FFmpeg extraction failed"
        }

        if (Test-Path $FFMPEG_DIR) {
            Remove-Item $FFMPEG_DIR -Recurse -Force
        }
        Rename-Item -Path $extractedDir.FullName -NewName "ffmpeg" -ErrorAction Stop

        Remove-Item $FFMPEG_ZIP_PATH -Force -ErrorAction SilentlyContinue
        Write-Host "Cleaned up downloaded archive."

        if (-not (Test-Path $FFMPEG_PATH)) {
            Write-Host "ERROR: FFmpeg executable not found at $FFMPEG_PATH after extraction" -ForegroundColor Red
            throw "FFmpeg installation verification failed"
        }

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
