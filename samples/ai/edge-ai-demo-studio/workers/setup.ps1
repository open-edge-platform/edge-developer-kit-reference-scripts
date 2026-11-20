# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [switch]$SkipSTT,
    [switch]$SkipEmbedding,
    [switch]$SkipLLM,
    [switch]$SkipTTS,
    [switch]$Verbose,
    [switch]$ContinueOnError, # Continue setup for remaining workers even if one fails
    [switch]$SetupWorkers    # Create the shared worker environment
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 redraws the progress bar per chunk, which makes
# Invoke-WebRequest and Expand-Archive many times slower, and may default to
# TLS 1.0, which GitHub refuses.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$SCRIPT_DIR = $PSScriptRoot
$LOG_DIR = Join-Path (Split-Path $SCRIPT_DIR -Parent) "logs\setup"
# Shared with scripts\win\setup.ps1 when it runs this, so Cleanup-OldLogs
# finds the parent's logs and leaves them alone.
$TIMESTAMP = if ($env:EADS_SETUP_TIMESTAMP) { $env:EADS_SETUP_TIMESTAMP } else { Get-Date -Format "yyyyMMdd_HHmmss" }

function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

function Cleanup-OldLogs {
    if (Test-Path $LOG_DIR) {
        $currentTimestampLogs = Get-ChildItem -Path $LOG_DIR -Include "*_${TIMESTAMP}.log" -Recurse -File -ErrorAction SilentlyContinue
        if ($currentTimestampLogs.Count -eq 0) {
            Write-ColorOutput "Cleaning up old setup logs..." "Yellow"
            Get-ChildItem -Path $LOG_DIR -Include "*.log","*.log.*" -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
            # Remove empty subdirectories
            Get-ChildItem -Path $LOG_DIR -Directory -Recurse | Where-Object { @(Get-ChildItem -Path $_.FullName -Force).Count -eq 0 } | Remove-Item -Force -ErrorAction SilentlyContinue
            Write-ColorOutput "Old logs removed." "Green"
        } else {
            Write-ColorOutput "Skipping log cleanup (running as part of main setup)" "Yellow"
        }
    }
}

function Setup-Logging {
    if (-not (Test-Path $LOG_DIR)) {
        New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
    }
    Cleanup-OldLogs
    if (-not $Verbose) {
        Write-ColorOutput "Detailed logs will be written to: $LOG_DIR" "White"
    }
}

function Get-ServiceLog {
    param([string]$ServiceName)
    $serviceLogDir = Join-Path $LOG_DIR $ServiceName
    if (-not (Test-Path $serviceLogDir)) {
        New-Item -ItemType Directory -Path $serviceLogDir -Force | Out-Null
    }
    return Join-Path $serviceLogDir "${ServiceName}_${TIMESTAMP}.log"
}

$thirdpartyDir = Join-Path $SCRIPT_DIR "thirdparty"
$rootThirdpartyDir = Join-Path (Split-Path $SCRIPT_DIR -Parent) "thirdparty"

# Checked downloads and install manifests: scripts\win\ in the repo, scripts\ in a packaged build.
$integrityScript = @('scripts\win', 'scripts') |
    ForEach-Object { Join-Path (Split-Path $SCRIPT_DIR -Parent) "$_\thirdparty_integrity.ps1" } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $integrityScript) {
    Write-ColorOutput "❌ ERROR: thirdparty_integrity.ps1 not found next to the project's setup scripts." "Red"
    exit 1
}
. $integrityScript

# Each download is checked against the SHA-256 beside its URL (see thirdparty_integrity.ps1). Moving
# to another release means updating both, from the project's own checksum list where it has one.
# Another uv release writes uv.lock differently when it re-locks, so a copy from any other download
# is replaced.
$uvZipUrl = "https://releases.astral.sh/github/uv/releases/download/0.13.7/uv-x86_64-pc-windows-msvc.zip"
# From the release's uv-x86_64-pc-windows-msvc.zip.sha256
$uvSha256 = "0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021"
$uvDir = Join-Path $thirdpartyDir "uv"
$uvPath = Join-Path $uvDir "uv.exe"

$ovmsZipUrl = 'https://github.com/openvinotoolkit/model_server/releases/download/v2026.4.1/ovms_windows_2026.4.1_python_on.zip'
# GitHub's digest of the release asset
$ovmsSha256 = "aa79a0ae3b858356ba550978e397a8e8876a9d2706ffe4041b1dfd3f32cb8ce4"
# Initialize-Ovms (worker-common.ps1) installs and upgrades packages in these: the manifest leaves them out.
$ovmsExclude = @('python/Lib/site-packages', 'python/Scripts')
$ovmsDir = Join-Path $thirdpartyDir "ovms"
$ovmsPath = Join-Path $ovmsDir "ovms.exe"

$ffmpegDir = Join-Path $rootThirdpartyDir "ffmpeg"
$ffmpegPath = Join-Path $ffmpegDir "bin\ffmpeg.exe"

function Test-UvInstalled {
    Write-ColorOutput "Checking if uv is installed..." "Yellow"

    $uvLogFile = Get-ServiceLog -ServiceName "uv"
    "=== UV Setup Log - $(Get-Date) ===" | Out-File -FilePath $uvLogFile -Encoding utf8

    try {
        $null = Install-VerifiedArchive -Label "uv" -Url $uvZipUrl -Sha256 $uvSha256 -Destination $uvDir

        if (-not (Test-Path $uvPath)) {
            Write-ColorOutput "❌ ERROR: uv executable not found at $uvPath after extraction" "Red"
            "UV setup failed at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
            exit 1
        }
        
        & $uvPath --version | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-ColorOutput "❌ ERROR: uv installation verification failed" "Red"
            "UV setup failed at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
            exit 1
        }
        
        Write-ColorOutput "✅ uv is ready." "Green"
        "UV setup completed successfully at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
        return $uvPath
    } catch {
        Write-ColorOutput "❌ ERROR: Failed to download/extract uv." "Red"
        Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
        Write-ColorOutput "Please check your internet connection and try again." "Yellow"
        Write-ColorOutput "Or manually download uv from: https://github.com/astral-sh/uv/releases" "Yellow"
        Write-ColorOutput "Extract uv.exe to: $PWD\thirdparty\uv\" "White"
        "UV setup failed at $(Get-Date): $($_.Exception.Message)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
        exit 1
    }
}

function Get-ThirdPartyDependencies {
    Write-ColorOutput "Creating thirdparty directory..." "Yellow"
    
    try {
        if (-not (Test-Path $thirdpartyDir)) {
            New-Item -ItemType Directory -Path $thirdpartyDir -ErrorAction Stop | Out-Null
        }
    } catch {
        Write-ColorOutput "❌ ERROR: Failed to create thirdparty directory" "Red"
        exit 1
    }

    Set-Location $thirdpartyDir

    # Replaced unless intact and from this download: a new one is extracted beside it, so a
    # failure leaves it usable. Its bundled Python's packages come back on the next Initialize-Ovms.
    $ovmsLogFile = Get-ServiceLog -ServiceName "ovms"
    "=== OVMS Setup Log - $(Get-Date) ===" | Out-File -FilePath $ovmsLogFile -Encoding utf8
    try {
        $null = Install-VerifiedArchive -Label "OpenVINO Model Server" -Url $ovmsZipUrl -Sha256 $ovmsSha256 `
            -Destination $ovmsDir -Exclude $ovmsExclude
        if (-not (Test-Path $ovmsPath)) { throw "ovms.exe not found at $ovmsPath after extraction" }
        "OVMS setup completed successfully at $(Get-Date)" | Out-File -FilePath $ovmsLogFile -Append -Encoding utf8
    } catch {
        Write-ColorOutput "❌ ERROR: Failed to install OVMS (stop Edge AI Studio first if it is running)" "Red"
        Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
        "OVMS setup failed at $(Get-Date): $($_.Exception.Message)" | Out-File -FilePath $ovmsLogFile -Append -Encoding utf8
        Set-Location "..\"
        exit 1
    }
    
    if (-not (Test-Path $ffmpegPath)) {
        Write-ColorOutput "⚠️  WARNING: FFmpeg not found at $ffmpegPath" "Yellow"
        Write-ColorOutput "FFmpeg should be installed by the main setup.ps1 script at the project root." "Yellow"
        Write-ColorOutput "If you're running workers/setup.ps1 directly, please run setup.ps1 from the project root first." "Yellow"
    } else {
        Write-ColorOutput "✅ FFmpeg found at $ffmpegPath" "Green"
    }
    
    Set-Location "..\"
}

function Invoke-WorkerSetup {
    param([string]$WorkerPath, [string]$WorkerName)
    
    Write-ColorOutput "Running setup for $WorkerName..." "Yellow"
    
    $setupScript = Join-Path $WorkerPath "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        Write-ColorOutput "Warning: setup.ps1 not found in $WorkerPath, skipping..." "Yellow"
        return @{ Success = $false; ErrorMessage = "setup.ps1 not found"; ExitCode = -1 }
    }
    
    $workerLogFile = Get-ServiceLog -ServiceName $WorkerName
    $workerErrorLogFile = "${workerLogFile}.err"
    "=== $WorkerName Setup Log - $(Get-Date) ===" | Out-File -FilePath $workerLogFile -Encoding utf8
    
    try {
        $scriptArgs = @("-File", $setupScript)

        # Use the same PowerShell executable that is running this script (pwsh vs powershell.exe)
        $psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        
        Write-ColorOutput "Logging to: $workerLogFile" "DarkGray"
        
        $setupProcess = Start-Process -FilePath $psExe `
            -ArgumentList $scriptArgs `
            -WorkingDirectory $WorkerPath `
            -PassThru `
            -WindowStyle Hidden `
            -Wait `
            -RedirectStandardOutput $workerLogFile `
            -RedirectStandardError $workerErrorLogFile
        
        if ($Verbose) {
            if (Test-Path $workerLogFile) {
                Get-Content $workerLogFile | Write-Host
            }
            if (Test-Path $workerErrorLogFile) {
                $errContent = Get-Content $workerErrorLogFile -ErrorAction SilentlyContinue
                if ($errContent) { $errContent | Write-Host }
            }
        }
        
        if ($setupProcess.ExitCode -eq 0) {
            Write-ColorOutput "✅ $WorkerName setup completed successfully!" "Green"
            Write-ColorOutput "Log: $workerLogFile" "DarkGray"
            return @{ Success = $true; ErrorMessage = $null; ExitCode = $setupProcess.ExitCode }
        } else {
            Write-Host ""
            Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Red
            Write-Host "║  ❌ WORKER SETUP FAILED: $WorkerName" -ForegroundColor Red
            Write-Host "║  Exit Code: $($setupProcess.ExitCode)" -ForegroundColor Red
            Write-Host "║  Log: $workerLogFile" -ForegroundColor Red
            Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Red
            Write-Host ""
            
            $errorMsg = "Setup failed with exit code $($setupProcess.ExitCode)"
            return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = $setupProcess.ExitCode; WorkerName = $WorkerName }
        }

    } catch {
        $errorMsg = $_.Exception.Message
        Write-ColorOutput "Setup failed for $WorkerName`: $errorMsg" "Red"
        return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = -1 }
    }
}

Push-Location $SCRIPT_DIR
Write-ColorOutput "=== Workers Setup ===" "Cyan"

Setup-Logging

Test-UvInstalled

$env:UV_PATH = $uvPath
$env:UV_EXE = $uvPath

Get-ThirdPartyDependencies
$WorkersRoot = $PSScriptRoot
$ScriptDir = $PSScriptRoot
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")
Initialize-Ovms

if (-not $SetupWorkers) {
    Write-ColorOutput "Shared third-party tools are ready. Use -SetupWorkers to create the shared environment." "Yellow"
    exit 0
}

if ($SkipSTT -or $SkipTTS -or $SkipLLM -or $SkipEmbedding) {
    Write-ColorOutput "NOTE: -Skip flags have no effect; service dependencies are installed on first start." "Yellow"
}

Write-ColorOutput "Syncing shared worker packages into workers\.venv..." "Yellow"
$failed = $false
$wsLog = Get-ServiceLog -ServiceName "workspace"
# uv logs progress to stderr; under "Stop", PS 5.1 would treat that as a terminating error.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $uvPath sync --frozen --inexact --project $PSScriptRoot --package worker-common --package model-downloader --package helper *>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $wsLog
$ErrorActionPreference = $prevEAP
if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput "Shared worker environment ready: $(Join-Path $PSScriptRoot '.venv')" "Green"
} else {
    Write-ColorOutput "FAILED: Shared worker sync (exit $LASTEXITCODE). See $wsLog" "Red"
    if (-not $ContinueOnError) { exit 1 }
    $failed = $true
}

$engineSetup = Join-Path $PSScriptRoot "engines\setup.ps1"
if (Test-Path $engineSetup) {
    $engineLog = Get-ServiceLog -ServiceName "engines"
    $ErrorActionPreference = "Continue"
    $psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $engineSetup *>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $engineLog
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "FAILED: Engine setup (exit $LASTEXITCODE). See $engineLog" "Red"
        exit 1
    }
}
if ($failed) { exit 1 }
Write-ColorOutput "Shared third-party tools and worker environment are ready. Service dependencies install on first start." "Green"
exit 0
