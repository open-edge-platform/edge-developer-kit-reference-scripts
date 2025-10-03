# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Parameters for switches and options
param(
    [switch]$SkipSTT,
    [switch]$SkipEmbedding,
    [switch]$SkipLLM,
    [switch]$SkipTTS,
    [switch]$Verbose
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Function to write colored output
function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

$thirdpartyDir = Join-Path $PWD "thirdparty"
$uvZipPath = Join-Path $thirdpartyDir "uv.zip"
$uvZipUrl = "https://github.com/astral-sh/uv/releases/download/0.8.13/uv-x86_64-pc-windows-msvc.zip"
$uvDir = Join-Path $thirdpartyDir "uv"
$uvPath = Join-Path $uvDir "uv.exe"

$ovmsZipPath = Join-Path $thirdpartyDir "ovms_windows.zip"
$ovmsZipUrl = 'https://github.com/openvinotoolkit/model_server/releases/download/v2025.2.1/ovms_windows_python_on.zip'
$ovmsDir = Join-Path $thirdpartyDir "ovms"
$ovmsPath = Join-Path $ovmsDir "ovms.exe"

$ffmpegZipPath = Join-Path $thirdpartyDir "ffmpeg-release-essentials.zip"
$ffmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$ffmpegDir = Join-Path $thirdpartyDir "ffmpeg"
$ffmpegPath = Join-Path $ffmpegDir "bin\ffmpeg.exe"

# Function to check if uv is installed
function Test-UvInstalled {
    Write-Host "Checking if uv is installed..." -ForegroundColor Yellow
    
    # Check if uv exists in thirdparty folder (local to workers directory)
    if (Test-Path $uvPath) {
        Write-Host "uv found in thirdparty folder." -ForegroundColor Green
        # Test uv directly without adding to PATH
        & $uvPath --version | Out-Null
        return $uvPath
    }
    
    # uv not found in thirdparty, download it
    try {
        Write-Host "uv is not installed. Downloading uv binary..." -ForegroundColor Yellow
        
        # Create thirdparty directory in workers folder if it doesn't exist
        if (-not (Test-Path $thirdpartyDir)) {
            New-Item -ItemType Directory -Path $thirdpartyDir | Out-Null
        }
        
        # Create uv subdirectory
        if (-not (Test-Path $uvDir)) {
            New-Item -ItemType Directory -Path $uvDir | Out-Null
        }
        
        # Download uv zip file        
        Write-Host "Downloading uv from $uvZipUrl..." -ForegroundColor White
        Invoke-WebRequest -Uri $uvZipUrl -OutFile $uvZipPath
        
        # Extract the zip file to uv subdirectory
        Write-Host "Extracting uv binary..." -ForegroundColor White
        Expand-Archive -Path $uvZipPath -DestinationPath $uvDir -Force
        
        # Remove the zip file
        Remove-Item $uvZipPath
        
        # Test if uv works directly
        & $uvPath --version | Out-Null
        Write-Host "uv is successfully downloaded and extracted." -ForegroundColor Green
        return $uvPath
    } catch {
        Write-Host "ERROR: Failed to download/extract uv." -ForegroundColor Red
        Write-Host "Please manually download uv from: https://github.com/astral-sh/uv/releases" -ForegroundColor Yellow
        Write-Host "Extract uv.exe to: $PWD\thirdparty\uv\" -ForegroundColor White
        Read-Host "Press Enter to continue..."
        exit 1
    }
}

# Function to download third-party dependencies
function Get-ThirdPartyDependencies {
    Write-Host "Creating thirdparty directory..." -ForegroundColor Yellow
    if (-not (Test-Path $thirdpartyDir)) {
        New-Item -ItemType Directory -Path $thirdpartyDir | Out-Null
    }

    Set-Location $thirdpartyDir

    # Install OVMS
    if (Test-Path "ovms") {
        Write-Host "OVMS directory already exists. Skipping download." -ForegroundColor Green
    } else {
        Write-Host "Downloading OpenVINO Model Server for Windows..." -ForegroundColor Yellow
        try {
            Invoke-WebRequest -Uri $ovmsZipUrl -OutFile $ovmsZipPath
            Expand-Archive -Path $ovmsZipPath -DestinationPath $thirdpartyDir
            Remove-Item $ovmsZipPath
            Write-Host "OVMS downloaded and extracted successfully." -ForegroundColor Green
        } catch {
            Write-Host "Failed to download OVMS." -ForegroundColor Red
            throw
        }
    }
    
    # Install FFmpeg
    if (Test-Path "ffmpeg") {
        Write-Host "FFmpeg directory already exists. Skipping download." -ForegroundColor Green
    } else {
        Write-Host "Downloading FFmpeg for Windows..." -ForegroundColor Yellow
        try {
            Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZipPath
            Expand-Archive -Path $ffmpegZipPath -DestinationPath $thirdpartyDir -Force
            
            # Find the extracted directory (it usually has a version number)
            $extractedDir = Get-ChildItem -Path $thirdpartyDir -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
            
            if ($extractedDir) {
                # Rename to simply "ffmpeg"
                Rename-Item -Path $extractedDir.FullName -NewName "ffmpeg"
            }
            
            Remove-Item $ffmpegZipPath -Force
            
            if (Test-Path $ffmpegPath) {
                Write-Host "FFmpeg downloaded and extracted successfully." -ForegroundColor Green
            } else {
                Write-Host "FFmpeg installation verification failed." -ForegroundColor Red
            }
        } catch {
            Write-Host "Failed to download FFmpeg." -ForegroundColor Red
            throw
        }
    }
    
    Set-Location "..\"
}

# Function to run setup for a worker service
function Invoke-WorkerSetup {
    param([string]$WorkerPath, [string]$WorkerName)
    
    Write-ColorOutput "Running setup for $WorkerName..." "Yellow"
    
    # Check if setup.ps1 exists
    $setupScript = Join-Path $WorkerPath "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        Write-ColorOutput "Warning: setup.ps1 not found in $WorkerPath, skipping..." "Yellow"
        return
    }
    
    try {
        Write-ColorOutput "=== $WorkerName Setup Started ===" "Cyan"
        
        if ($Verbose) {
            # In verbose mode, show output directly in the same window
            $setupProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-File", $setupScript -WorkingDirectory $WorkerPath -PassThru -NoNewWindow -Wait
        } else {
            # In non-verbose mode, show filtered/summarized output
            Write-ColorOutput "This may take several minutes depending on your internet connection..." "White"
            Write-ColorOutput "Use -Verbose to see detailed output." "White"
            
            # Create a job to run the setup script so we can monitor it
            $job = Start-Job -ScriptBlock {
                param($SetupScript, $WorkingDirectory)
                $process = Start-Process -FilePath "powershell.exe" -ArgumentList "-File", $SetupScript -WorkingDirectory $WorkingDirectory -PassThru -WindowStyle Hidden -Wait
                return $process.ExitCode
            } -ArgumentList $setupScript, $WorkerPath
            
            # Show progress dots while waiting
            $dotCount = 0
            while ($job.State -eq "Running") {
                Start-Sleep -Seconds 2
                Write-Host "." -NoNewline -ForegroundColor Yellow
                $dotCount++
                if ($dotCount % 30 -eq 0) {
                    Write-Host "`n$WorkerName setup still running..." -ForegroundColor Yellow
                }
            }
            
            # Get the result
            $exitCode = Receive-Job -Job $job
            Remove-Job -Job $job
            
            # Create a mock process object for consistency
            $setupProcess = New-Object PSObject -Property @{
                ExitCode = $exitCode
            }
            
            Write-Host ""  # New line after dots
        }
        
        # Check the exit code
        if ($setupProcess.ExitCode -eq 0) {
            Write-ColorOutput "$WorkerName setup completed successfully!" "Green"
        } else {
            Write-ColorOutput "$WorkerName setup failed with exit code $($setupProcess.ExitCode)!" "Red"
            throw "Setup failed for $WorkerName with exit code $($setupProcess.ExitCode)"
        }
        
        return $setupProcess
    } catch {
        Write-ColorOutput "Setup failed for $WorkerName`: $($_.Exception.Message)" "Red"
        throw
    }
}

Test-UvInstalled
Get-ThirdPartyDependencies

# Main script
Write-ColorOutput "=== Workers Setup ===" "Cyan"

# Discover all subdirectories with setup.ps1 files
$workerDirectories = Get-ChildItem -Path $PWD -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName "setup.ps1")
}

if ($workerDirectories.Count -eq 0) {
    Write-ColorOutput "No worker directories with setup.ps1 found." "Yellow"
    exit 0
}

# Create service mapping for skip parameters
$skipMapping = @{
    "speech-to-speech" = $SkipSTT
    "embedding" = $SkipEmbedding
    "text-generation" = $SkipLLM
    "text-to-speech" = $SkipTTS
}

Write-ColorOutput "Found worker directories:" "White"
foreach ($dir in $workerDirectories) {
    $shouldSkip = $skipMapping[$dir.Name]
    $status = if ($shouldSkip) { " (SKIPPED)" } else { "" }
    Write-ColorOutput "  - $($dir.Name)$status" "White"
}
Write-ColorOutput "=================" "Cyan"

try {    
    foreach ($workerDir in $workerDirectories) {
        $shouldSkip = $skipMapping[$workerDir.Name]
        
        if (-not $shouldSkip) {
            Write-ColorOutput "Starting $($workerDir.Name) setup..." "Yellow"
            try {
                $setupProcess = Invoke-WorkerSetup -WorkerPath $workerDir.FullName -WorkerName $workerDir.Name
            } catch {
                Write-ColorOutput "$($workerDir.Name) setup failed: $($_.Exception.Message)" "Red"
                throw
            }
        } else {
            Write-ColorOutput "Skipping $($workerDir.Name) setup..." "Yellow"
        }
    }
    
    Write-ColorOutput "All worker setup processes completed successfully!" "Green"
} catch {
    Write-ColorOutput "Error occurred: $($_.Exception.Message)" "Red"
    if ($Verbose) {
        Write-ColorOutput "Stack trace: $($_.ScriptStackTrace)" "Red"
    }
    exit 1
}