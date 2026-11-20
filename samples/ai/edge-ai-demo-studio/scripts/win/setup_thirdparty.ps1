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

# Checked downloads and install manifests.
. (Join-Path $SCRIPT_DIR 'thirdparty_integrity.ps1')

# Each download is checked against the SHA-256 beside its URL (see thirdparty_integrity.ps1). Moving
# to another release means updating both, from the project's own checksum list where it has one.
$THIRDPARTY_DIR = if ($args.Count -ge 1) { $args[0] } else { Join-Path $SCRIPT_DIR '..\..\thirdparty' }
$NODE_VERSION = "v24.22.2"
$NODE_URL = "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
# From https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
$NODE_SHA256 = "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2"
$NODE_DIR = Join-Path $THIRDPARTY_DIR 'node'
$NODE_PATH = Join-Path $NODE_DIR 'node.exe'

$GIT_URL = "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.2/MinGit-2.51.0.2-64-bit.zip"
# From the release notes of v2.51.0.windows.2
$GIT_SHA256 = "314fc2b7425ca116ea201e493fcb72008376c64997e866e6c8b8a5b360b3b8a9"
$GIT_DIR = Join-Path $THIRDPARTY_DIR 'git'
$GIT_PATH = Join-Path $GIT_DIR 'cmd\git.exe'

$GIT_LFS_URL = "https://github.com/git-lfs/git-lfs/releases/download/v3.7.1/git-lfs-windows-amd64-v3.7.1.zip"
# From the release's sha256sums.asc
$GIT_LFS_SHA256 = "8683cdc3d6c029b49393dcebbaa6265bd6efd9abdcf837be855b4cd42e5e80b6"
$GIT_LFS_PATH = Join-Path $GIT_DIR 'cmd\git-lfs.exe'

$FFMPEG_ZIP_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0.zip"
# From the release's checksums.sha256
$FFMPEG_SHA256 = "ec9db2cda1f5894ab95446076ad8bf49379db4b53c02e778ad3b49adf91fec83"
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

# MinGit with Git LFS beside it: one install, so its manifest covers both and the LFS filters it registers.
function Install-Git {
    Write-Host "Setting up Git..."
    try {
        $null = Install-VerifiedArchive -Label "Git" -Url $GIT_URL -Sha256 $GIT_SHA256 -Destination $GIT_DIR `
            -Source "$GIT_SHA256+$GIT_LFS_SHA256" -AfterExtract { param($dir) Add-GitLfs $dir }

        if (-not (Test-Path $GIT_PATH) -or -not (Test-Path $GIT_LFS_PATH)) {
            Write-Host "ERROR: Git or Git LFS not found in $GIT_DIR after installation" -ForegroundColor Red
            throw "Git installation verification failed"
        }

        $gitVersion = & $GIT_PATH --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Git installation verification failed" -ForegroundColor Red
            throw "Git binary found but not working properly"
        }

        $lfsVersion = & $GIT_LFS_PATH --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Git LFS installation verification failed" -ForegroundColor Red
            throw "Git LFS binary found but not working properly"
        }

        Write-Host "Git installed successfully at $GIT_PATH" -ForegroundColor Green
        return $GIT_PATH
    } catch {
        Write-Host "ERROR: Failed to download or install Git: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
        throw
    }
}

# Add-GitLfs <git dir> -- put Git LFS into the MinGit extracted at <git dir> and register its filters there.
function Add-GitLfs {
    param([string]$GitDir)
    Write-Host "Setting up Git LFS..."
    $downloadPath = Join-Path $GitDir 'git-lfs.zip'
    $tempExtract = Join-Path $GitDir 'git-lfs-tmp'
    try {
        Write-Host "Downloading Git LFS from $GIT_LFS_URL ..."
        Save-VerifiedDownload -Url $GIT_LFS_URL -OutFile $downloadPath -Sha256 $GIT_LFS_SHA256
        Write-Host "Checksum verified. Extracting Git LFS ..."
        Expand-Archive -Path $downloadPath -DestinationPath $tempExtract -Force -ErrorAction Stop

        $lfsExe = Get-ChildItem -Path $tempExtract -Recurse -Filter 'git-lfs.exe' | Select-Object -First 1
        if (-not $lfsExe) {
            throw "git-lfs.exe not found in downloaded archive"
        }

        # Place git-lfs next to git.exe (cmd\) so it is always found on PATH, and
        # in mingw64\bin so git's internal filter lookup resolves it too.
        Copy-Item $lfsExe.FullName -Destination (Join-Path $GitDir 'cmd\git-lfs.exe') -Force
        $mingwBin = Join-Path $GitDir 'mingw64\bin'
        if (Test-Path $mingwBin) {
            Copy-Item $lfsExe.FullName -Destination (Join-Path $mingwBin 'git-lfs.exe') -Force
        }
    } finally {
        Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Register the LFS filters in the bundled git's system config, for every process using it.
    # --skip-repo: no hooks in the surrounding repository. Continue: under Stop, Windows
    # PowerShell 5.1 throws on redirected stderr.
    $git = Join-Path $GitDir 'cmd\git.exe'
    & { $ErrorActionPreference = 'Continue'; & $git lfs install --system --skip-repo 2>&1 | Out-Null }
}

function Install-Node {
    Write-Host "Setting up Node.js..."
    try {
        $null = Install-VerifiedArchive -Label "Node.js $NODE_VERSION" -Url $NODE_URL -Sha256 $NODE_SHA256 -Destination $NODE_DIR

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
    try {
        $null = Install-VerifiedArchive -Label "FFmpeg" -Url $FFMPEG_ZIP_URL -Sha256 $FFMPEG_SHA256 -Destination $FFMPEG_DIR

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
