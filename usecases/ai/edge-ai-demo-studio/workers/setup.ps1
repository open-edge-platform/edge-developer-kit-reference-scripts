# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Parameters for switches and options
param(
    [switch]$SkipSTT,
    [switch]$SkipEmbedding,
    [switch]$SkipLLM,
    [switch]$SkipTTS,
    [switch]$Verbose,
    [switch]$ContinueOnError  # Continue setup for remaining workers even if one fails
)

# Set UTF-8 encoding for console output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Set error action preference
$ErrorActionPreference = "Stop"

# Define logging paths
$SCRIPT_DIR = $PSScriptRoot
$LOG_DIR = Join-Path (Split-Path $SCRIPT_DIR -Parent) "logs\setup"
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"

# Function to write colored output
function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

# Function to cleanup old logs
function Cleanup-OldLogs {
    if (Test-Path $LOG_DIR) {
        # Check if there are any logs with current timestamp (means we're called from parent setup)
        # In that case, don't cleanup as it would delete the parent's log file
        $currentTimestampLogs = Get-ChildItem -Path $LOG_DIR -Include "*_${TIMESTAMP}.log" -Recurse -File -ErrorAction SilentlyContinue
        if ($currentTimestampLogs.Count -eq 0) {
            Write-ColorOutput "Cleaning up old setup logs..." "Yellow"
            # Remove all log files recursively from subdirectories
            Get-ChildItem -Path $LOG_DIR -Include "*.log","*.log.*" -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
            # Remove empty subdirectories
            Get-ChildItem -Path $LOG_DIR -Directory -Recurse | Where-Object { @(Get-ChildItem -Path $_.FullName -Force).Count -eq 0 } | Remove-Item -Force -ErrorAction SilentlyContinue
            Write-ColorOutput "Old logs removed." "Green"
        } else {
            Write-ColorOutput "Skipping log cleanup (running as part of main setup)" "Yellow"
        }
    }
}

# Function to setup logging
function Setup-Logging {
    if (-not $Verbose) {
        if (-not (Test-Path $LOG_DIR)) {
            New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
        }
        Cleanup-OldLogs
        Write-ColorOutput "Detailed logs will be written to service-specific files in: $LOG_DIR" "White"
    }
}

# Function to get service-specific log file
function Get-ServiceLog {
    param([string]$ServiceName)
    $serviceLogDir = Join-Path $LOG_DIR $ServiceName
    if (-not (Test-Path $serviceLogDir)) {
        New-Item -ItemType Directory -Path $serviceLogDir -Force | Out-Null
    }
    return Join-Path $serviceLogDir "${ServiceName}_${TIMESTAMP}.log"
}

$thirdpartyDir = Join-Path $PWD "thirdparty"
$uvZipPath = Join-Path $thirdpartyDir "uv.zip"
$uvZipUrl = "https://github.com/astral-sh/uv/releases/download/0.8.13/uv-x86_64-pc-windows-msvc.zip"
$uvDir = Join-Path $thirdpartyDir "uv"
$uvPath = Join-Path $uvDir "uv.exe"

$ovmsZipPath = Join-Path $thirdpartyDir "ovms_windows.zip"
$ovmsZipUrl = 'https://github.com/openvinotoolkit/model_server/releases/download/v2025.3/ovms_windows_python_on.zip'
$ovmsDir = Join-Path $thirdpartyDir "ovms"
$ovmsPath = Join-Path $ovmsDir "ovms.exe"

$ffmpegZipPath = Join-Path $thirdpartyDir "ffmpeg-release-essentials.zip"
$ffmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$ffmpegDir = Join-Path $thirdpartyDir "ffmpeg"
$ffmpegPath = Join-Path $ffmpegDir "bin\ffmpeg.exe"

# Function to check if uv is installed
function Test-UvInstalled {
    Write-ColorOutput "Checking if uv is installed..." "Yellow"
    
    # Check if uv exists in thirdparty folder (local to workers directory)
    if (Test-Path $uvPath) {
        Write-ColorOutput "✅ uv found in thirdparty folder." "Green"
        # Test uv directly without adding to PATH
        try {
            & $uvPath --version | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-ColorOutput "❌ ERROR: uv binary found but not working properly" "Red"
                exit 1
            }
            return $uvPath
        } catch {
            Write-ColorOutput "❌ ERROR: uv binary found but not working properly" "Red"
            exit 1
        }
    }
    
    # uv not found in thirdparty, download it
    Write-ColorOutput "uv is not installed. Downloading uv binary..." "Yellow"
    
    $uvLogFile = Get-ServiceLog -ServiceName "uv"
    if (-not $Verbose) {
        "=== UV Setup Log - $(Get-Date) ===" | Out-File -FilePath $uvLogFile -Encoding utf8
        "" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
        Write-ColorOutput "Logging UV setup to: $uvLogFile" "White"
    }
    
    try {
        # Create thirdparty directory in workers folder if it doesn't exist
        if (-not (Test-Path $thirdpartyDir)) {
            New-Item -ItemType Directory -Path $thirdpartyDir -ErrorAction Stop | Out-Null
        }
        
        # Create uv subdirectory
        if (-not (Test-Path $uvDir)) {
            New-Item -ItemType Directory -Path $uvDir -ErrorAction Stop | Out-Null
        }
        
        # Download uv zip file        
        Write-ColorOutput "Downloading uv from $uvZipUrl..." "White"
        Invoke-WebRequest -Uri $uvZipUrl -OutFile $uvZipPath -ErrorAction Stop
        
        # Extract the zip file to uv subdirectory
        Write-ColorOutput "Extracting uv binary..." "White"
        Expand-Archive -Path $uvZipPath -DestinationPath $uvDir -Force -ErrorAction Stop
        
        # Remove the zip file
        Remove-Item $uvZipPath -Force -ErrorAction SilentlyContinue
        
        # Verify installation
        if (-not (Test-Path $uvPath)) {
            Write-ColorOutput "❌ ERROR: uv executable not found at $uvPath after extraction" "Red"
            if (-not $Verbose) {
                "UV setup failed at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
            }
            exit 1
        }
        
        # Test if uv works directly
        & $uvPath --version | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-ColorOutput "❌ ERROR: uv installation verification failed" "Red"
            if (-not $Verbose) {
                "UV setup failed at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
            }
            exit 1
        }
        
        Write-ColorOutput "✅ uv is successfully downloaded and extracted." "Green"
        if (-not $Verbose) {
            "UV setup completed successfully at $(Get-Date)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
        }
        return $uvPath
    } catch {
        Write-ColorOutput "❌ ERROR: Failed to download/extract uv." "Red"
        Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
        Write-ColorOutput "Please check your internet connection and try again." "Yellow"
        Write-ColorOutput "Or manually download uv from: https://github.com/astral-sh/uv/releases" "Yellow"
        Write-ColorOutput "Extract uv.exe to: $PWD\thirdparty\uv\" "White"
        if (-not $Verbose) {
            "UV setup failed at $(Get-Date): $($_.Exception.Message)" | Out-File -FilePath $uvLogFile -Append -Encoding utf8
        }
        exit 1
    }
}

# Function to download third-party dependencies
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

    # Install OVMS
    if (Test-Path "ovms") {
        Write-ColorOutput "✅ OVMS directory already exists. Skipping download." "Green"
    } else {
        Write-ColorOutput "Downloading OpenVINO Model Server for Windows..." "Yellow"
        
        $ovmsLogFile = Get-ServiceLog -ServiceName "ovms"
        if (-not $Verbose) {
            "=== OVMS Setup Log - $(Get-Date) ===" | Out-File -FilePath $ovmsLogFile -Encoding utf8
            "" | Out-File -FilePath $ovmsLogFile -Append -Encoding utf8
            Write-ColorOutput "Logging OVMS setup to: $ovmsLogFile" "White"
        }
        
        try {
            Write-ColorOutput "Downloading from $ovmsZipUrl..." "White"
            Invoke-WebRequest -Uri $ovmsZipUrl -OutFile $ovmsZipPath -ErrorAction Stop
            
            Write-ColorOutput "Extracting OVMS..." "White"
            Expand-Archive -Path $ovmsZipPath -DestinationPath $thirdpartyDir -ErrorAction Stop
            Remove-Item $ovmsZipPath -Force -ErrorAction SilentlyContinue
            
            Write-ColorOutput "✅ OVMS downloaded and extracted successfully." "Green"
            if (-not $Verbose) {
                "OVMS setup completed successfully at $(Get-Date)" | Out-File -FilePath $ovmsLogFile -Append -Encoding utf8
            }
        } catch {
            Write-ColorOutput "❌ ERROR: Failed to download OVMS" "Red"
            Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
            if (-not $Verbose) {
                "OVMS setup failed at $(Get-Date): $($_.Exception.Message)" | Out-File -FilePath $ovmsLogFile -Append -Encoding utf8
            }
            Set-Location "..\"
            exit 1
        }
    }
    
    # Install FFmpeg
    if (Test-Path "ffmpeg") {
        Write-ColorOutput "✅ FFmpeg directory already exists. Skipping download." "Green"
    } else {
        Write-ColorOutput "Downloading FFmpeg for Windows..." "Yellow"
        
        $ffmpegLogFile = Get-ServiceLog -ServiceName "ffmpeg"
        if (-not $Verbose) {
            "=== FFmpeg Setup Log - $(Get-Date) ===" | Out-File -FilePath $ffmpegLogFile -Encoding utf8
            "" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
            Write-ColorOutput "Logging FFmpeg setup to: $ffmpegLogFile" "White"
        }
        
        try {
            Write-ColorOutput "Downloading from $ffmpegZipUrl..." "White"
            Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZipPath -ErrorAction Stop
            
            Write-ColorOutput "Extracting FFmpeg..." "White"
            Expand-Archive -Path $ffmpegZipPath -DestinationPath $thirdpartyDir -Force -ErrorAction Stop
            
            # Find the extracted directory (it usually has a version number)
            $extractedDir = Get-ChildItem -Path $thirdpartyDir -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
            
            if (-not $extractedDir) {
                Write-ColorOutput "❌ ERROR: Could not find extracted FFmpeg directory" "Red"
                Remove-Item $ffmpegZipPath -Force -ErrorAction SilentlyContinue
                if (-not $Verbose) {
                    "FFmpeg setup failed at $(Get-Date): Extracted directory not found" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
                }
                Set-Location "..\"
                exit 1
            }
            
            # Rename to simply "ffmpeg"
            Rename-Item -Path $extractedDir.FullName -NewName "ffmpeg" -ErrorAction Stop
            
            Remove-Item $ffmpegZipPath -Force -ErrorAction SilentlyContinue
            
            # Verify installation
            if (-not (Test-Path $ffmpegPath)) {
                Write-ColorOutput "❌ ERROR: FFmpeg installation verification failed - binary not found" "Red"
                if (-not $Verbose) {
                    "FFmpeg setup failed at $(Get-Date): Binary not found" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
                }
                Set-Location "..\"
                exit 1
            }
            
            # Test FFmpeg
            & $ffmpegPath -version | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-ColorOutput "❌ ERROR: FFmpeg binary found but not working properly" "Red"
                if (-not $Verbose) {
                    "FFmpeg setup failed at $(Get-Date): Binary not working" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
                }
                Set-Location "..\"
                exit 1
            }
            
            Write-ColorOutput "✅ FFmpeg downloaded and extracted successfully." "Green"
            if (-not $Verbose) {
                "FFmpeg setup completed successfully at $(Get-Date)" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
            }
        } catch {
            Write-ColorOutput "❌ ERROR: Failed to download FFmpeg" "Red"
            Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
            if (-not $Verbose) {
                "FFmpeg setup failed at $(Get-Date): $($_.Exception.Message)" | Out-File -FilePath $ffmpegLogFile -Append -Encoding utf8
            }
            Set-Location "..\"
            exit 1
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
        return @{ Success = $false; ErrorMessage = "setup.ps1 not found"; ExitCode = -1 }
    }
    
    # Create worker-specific log file
    $workerLogFile = Get-ServiceLog -ServiceName $WorkerName
    $workerErrorLogFile = "${workerLogFile}.err"
    
    try {
        Write-ColorOutput "=== $WorkerName Setup Started ===" "Cyan"
        
        # Build arguments for the setup script
        $scriptArgs = @("-File", $setupScript)
        if ($Verbose) { 
            $scriptArgs += "-Verbose"
            Write-ColorOutput "Verbose mode enabled for $WorkerName" "Magenta"
        }
        
        if ($Verbose) {
            # In verbose mode, show output directly in the console and log to file
            Write-ColorOutput "Logging to: $workerLogFile" "DarkGray"
            $setupProcess = Start-Process -FilePath "powershell.exe" `
                -ArgumentList $scriptArgs `
                -WorkingDirectory $WorkerPath `
                -PassThru `
                -NoNewWindow `
                -Wait `
                -RedirectStandardOutput $workerLogFile `
                -RedirectStandardError $workerErrorLogFile
            
            # Display log content to console
            if (Test-Path $workerLogFile) {
                Get-Content $workerLogFile | Write-Host
            }
            if (Test-Path $workerErrorLogFile) {
                Get-Content $workerErrorLogFile | Write-Host
            }
        } else {
            # In non-verbose mode, log to file and show progress
            Write-ColorOutput "This may take several minutes depending on your internet connection..." "White"
            Write-ColorOutput "Logging to: $workerLogFile" "DarkGray"
            
            "=== $WorkerName Setup Log - $(Get-Date) ===" | Out-File -FilePath $workerLogFile -Encoding utf8
            "" | Out-File -FilePath $workerLogFile -Append -Encoding utf8
            
            # Run setup with output redirection
            $setupProcess = Start-Process -FilePath "powershell.exe" `
                -ArgumentList $scriptArgs `
                -WorkingDirectory $WorkerPath `
                -PassThru `
                -WindowStyle Hidden `
                -Wait `
                -RedirectStandardOutput $workerLogFile `
                -RedirectStandardError $workerErrorLogFile
        }
        
        # Check the exit code
        if ($setupProcess.ExitCode -eq 0) {
            Write-ColorOutput "✅ $WorkerName setup completed successfully!" "Green"
            if (-not $Verbose) {
                Write-ColorOutput "📋 Log: $workerLogFile" "DarkGray"
            }
            return @{ Success = $true; ErrorMessage = $null; ExitCode = $setupProcess.ExitCode }
        } else {
            Write-Host ""
            Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Red
            Write-Host "║  ❌ WORKER SETUP FAILED: $WorkerName" -ForegroundColor Red
            Write-Host "║  Exit Code: $($setupProcess.ExitCode)" -ForegroundColor Red
            Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Red
            Write-Host ""
            Write-ColorOutput "📋 Log: $workerLogFile" "Yellow"
            if (Test-Path $workerErrorLogFile) {
                Write-ColorOutput "📋 Error Log: $workerErrorLogFile" "Yellow"
            }
            
            $errorMsg = "Setup failed with exit code $($setupProcess.ExitCode)"
            return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = $setupProcess.ExitCode; WorkerName = $WorkerName }
        }
        
    } catch {
        $errorMsg = $_.Exception.Message
        Write-ColorOutput "Setup failed for $WorkerName`: $errorMsg" "Red"
        return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = -1 }
    }
}

# Main script
Write-ColorOutput "=== Workers Setup ===" "Cyan"

# Setup logging
Setup-Logging

Test-UvInstalled
Get-ThirdPartyDependencies

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

# Track setup results
$setupResults = @()
$successfulSetups = @()
$failedSetups = @()

try {    
    foreach ($workerDir in $workerDirectories) {
        $shouldSkip = $skipMapping[$workerDir.Name]
        
        if (-not $shouldSkip) {
            Write-ColorOutput "Starting $($workerDir.Name) setup..." "Yellow"
            
            $result = Invoke-WorkerSetup -WorkerPath $workerDir.FullName -WorkerName $workerDir.Name
            $setupResults += @{
                WorkerName = $workerDir.Name
                Success = $result.Success
                ErrorMessage = $result.ErrorMessage
                ExitCode = $result.ExitCode
            }
            
            if ($result.Success) {
                $successfulSetups += $workerDir.Name
            } else {
                $workerLogFile = Get-ServiceLog -ServiceName $workerDir.Name
                $failedSetups += @{
                    Name = $workerDir.Name
                    Error = $result.ErrorMessage
                    ExitCode = $result.ExitCode
                    LogFile = $workerLogFile
                }
                
                if (-not $Verbose -and (Test-Path $workerLogFile)) {
                    Write-ColorOutput "Log File: $workerLogFile" "Yellow"
                    Write-Host ""
                    Write-ColorOutput "To view the error details, run:" "White"
                    Write-ColorOutput "  Get-Content $workerLogFile" "Cyan"
                    Write-Host ""
                }
                
                if (-not $ContinueOnError) {
                    Write-ColorOutput "Setup failed for $($workerDir.Name). Use -ContinueOnError to continue with remaining workers." "Red"
                    throw "Setup failed for $($workerDir.Name): $($result.ErrorMessage)"
                } else {
                    Write-ColorOutput "⚠️  Setup failed for $($workerDir.Name), but continuing with remaining workers..." "Yellow"
                    Write-Host ""
                }
            }
        } else {
            Write-ColorOutput "Skipping $($workerDir.Name) setup..." "Yellow"
            $setupResults += @{
                WorkerName = $workerDir.Name
                Success = $null  # Indicates skipped
                ErrorMessage = "Skipped by user"
                ExitCode = 0
            }
        }
    }
    
    # Display summary
    Write-ColorOutput "`n=== Setup Summary ===" "Cyan"
    
    if ($successfulSetups.Count -gt 0) {
        Write-ColorOutput "✅ Successful setups ($($successfulSetups.Count)):" "Green"
        foreach ($success in $successfulSetups) {
            Write-ColorOutput "  - $success" "Green"
        }
    }
    
    if ($failedSetups.Count -gt 0) {
        Write-ColorOutput "❌ Failed setups ($($failedSetups.Count)):" "Red"
        foreach ($failure in $failedSetups) {
            Write-ColorOutput "  - $($failure.Name): $($failure.Error) (Exit Code: $($failure.ExitCode))" "Red"
            if (-not $Verbose -and $failure.LogFile -and (Test-Path $failure.LogFile)) {
                Write-ColorOutput "    Log: $($failure.LogFile)" "Yellow"
            }
        }
    }
    
    $skippedCount = ($setupResults | Where-Object { $_.Success -eq $null }).Count
    if ($skippedCount -gt 0) {
        Write-ColorOutput "⏭️  Skipped setups ($skippedCount):" "Yellow"
        foreach ($result in ($setupResults | Where-Object { $_.Success -eq $null })) {
            Write-ColorOutput "  - $($result.WorkerName)" "Yellow"
        }
    }
    
    Write-ColorOutput "===================" "Cyan"
    
    # Final status
    if ($failedSetups.Count -eq 0) {
        Write-ColorOutput "All worker setup processes completed successfully!" "Green"
        exit 0
    } else {
        # Print failed worker names prominently for parent script
        $failedWorkerNames = ($failedSetups | ForEach-Object { $_.Name }) -join ", "
        Write-Host ""
        Write-ColorOutput "╔════════════════════════════════════════════════════════════════╗" "Red"
        Write-ColorOutput "║  WORKERS SETUP FAILED - The following workers had errors:" "Red"
        Write-ColorOutput "║  → $failedWorkerNames" "Red"
        Write-ColorOutput "╚════════════════════════════════════════════════════════════════╝" "Red"
        Write-Host ""
        
        Write-ColorOutput "Some worker setups failed. Check the summary above for details." "Red"
        if (-not $Verbose) {
            Write-ColorOutput "Check individual service logs in $LOG_DIR for detailed error information." "Yellow"
        }
        exit 1
    }
    
} catch {
    Write-ColorOutput "Error occurred: $($_.Exception.Message)" "Red"
    if ($Verbose) {
        Write-ColorOutput "Stack trace: $($_.ScriptStackTrace)" "Red"
    }
    
    # Display partial summary if any setups were completed
    if ($setupResults.Count -gt 0) {
        Write-ColorOutput "`n=== Partial Setup Summary ===" "Cyan"
        foreach ($result in $setupResults) {
            if ($result.Success -eq $true) {
                Write-ColorOutput "✅ $($result.WorkerName): Success" "Green"
            } elseif ($result.Success -eq $false) {
                Write-ColorOutput "❌ $($result.WorkerName): $($result.ErrorMessage)" "Red"
            } else {
                Write-ColorOutput "⏭️  $($result.WorkerName): Skipped" "Yellow"
            }
        }
        Write-ColorOutput "===================" "Cyan"
    }
    
    exit 1
}