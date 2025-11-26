# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param(
    [switch]$SkipWorkers,
    [switch]$SkipFrontend,
    [switch]$SkipElectron,
    [switch]$EnableElectron,
    [switch]$Verbose,
    [switch]$ContinueOnError,
    [switch]$AutoYes
)

# Helper: Cleanup processes
function Cleanup {
    Write-ColorOutput "`nCleaning up jobs..." "Yellow"
    Get-Job | Stop-Job -ErrorAction SilentlyContinue
    Get-Job | Remove-Job -ErrorAction SilentlyContinue
    
    # Restore original directory
    try { Pop-Location -ErrorAction SilentlyContinue } catch { }
    
    Write-ColorOutput "Cleanup completed." "Green"
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup }

# Set error action preference
$ErrorActionPreference = "Stop"

# Set console output encoding to UTF-8 for proper emoji display
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Define paths relative to project root
$SCRIPT_DIR = $PSScriptRoot
$PROJECT_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$LOG_DIR = Join-Path $PROJECT_ROOT "logs\setup"
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"

# Change to project root directory
Push-Location $PROJECT_ROOT

# Function to write colored output
function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

# Function to cleanup old logs
function Cleanup-OldLogs {
    if (Test-Path $LOG_DIR) {
        Write-ColorOutput "Cleaning up old setup logs..." "Yellow"
        # Remove all log files recursively from subdirectories
        Get-ChildItem -Path $LOG_DIR -Include "*.log","*.log.*" -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
        # Remove empty subdirectories
        Get-ChildItem -Path $LOG_DIR -Directory -Recurse | Where-Object { @(Get-ChildItem -Path $_.FullName -Force).Count -eq 0 } | Remove-Item -Force -ErrorAction SilentlyContinue
        Write-ColorOutput "Old logs removed." "Green"
    }
}

# Function to setup logging
function Setup-Logging {
    if (-not (Test-Path $LOG_DIR)) {
        New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
    }
    
    if (-not $Verbose) {
        Cleanup-OldLogs
        
        # Initialize main log file for parent script operations
        $script:MainLogFile = Get-MainLog
        "=== Digital Avatar Services Setup Log - $(Get-Date) ===" | Out-File -FilePath $script:MainLogFile -Encoding utf8
        "" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        
        Write-ColorOutput "Detailed logs will be written to: $LOG_DIR" "White"
        Write-ColorOutput "Main setup log: $(Split-Path $script:MainLogFile -Leaf)" "DarkGray"
    } else {
        $script:MainLogFile = $null
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

# Function to get main setup log file
function Get-MainLog {
    return Join-Path $LOG_DIR "Setup_${TIMESTAMP}.log"
}

# Function to write output that respects verbose mode
function Write-Output-With-Logging {
    param([string]$Message, [string]$Color = "White")
    
    Write-ColorOutput $Message $Color
    
    # Also write to main log file in non-verbose mode
    if (-not $Verbose -and $script:MainLogFile) {
        $Message | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
    }
}

# Function to check for Intel GPU driver
function Test-IntelGPU {
    try {
        $intelGpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name -like "*Intel*" }
        
        if ($intelGpu) {
            Write-Output-With-Logging "✅ Intel GPU detected: $($intelGpu.Name)" "Green"
            if ($intelGpu.DriverVersion) {
                Write-Output-With-Logging "   Driver version: $($intelGpu.DriverVersion)" "DarkGray"
            }
            if (-not $Verbose -and $script:MainLogFile) {
                "Intel GPU found: $($intelGpu.Name), Driver: $($intelGpu.DriverVersion)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            }
            return $true
        } else {
            Write-Output-With-Logging "⚠️  WARNING: No Intel GPU detected!" "Yellow"
            Write-Output-With-Logging "" "White"
            Write-Output-With-Logging "   This application requires Intel GPU drivers for optimal performance." "Yellow"
            Write-Output-With-Logging "   Please install Intel Arc & Iris Xe Graphics drivers from:" "Yellow"
            Write-Output-With-Logging "   https://www.intel.com/content/www/us/en/download/785597/intel-arc-graphics-windows.html" "Cyan"
            Write-Output-With-Logging "" "White"
            Write-Output-With-Logging "   You can continue setup, but GPU-accelerated features may not work." "Yellow"
            Write-Output-With-Logging "" "White"
            
            if (-not $Verbose -and $script:MainLogFile) {
                "WARNING: No Intel GPU detected" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            }
            
            if (-not $AutoYes) {
                Read-Host "Press Enter to continue or press CTRL+C to abort setup and install the drivers first..."
            } else {
                Write-Output-With-Logging "   Auto-accepting to continue (non-interactive mode)..." "Yellow"
            }
            return $false
        }
    } catch {
        Write-Output-With-Logging "⚠️  WARNING: Unable to detect GPU information: $($_.Exception.Message)" "Yellow"
        if (-not $Verbose -and $script:MainLogFile) {
            "WARNING: GPU detection failed: $($_.Exception.Message)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
        return $false
    }
}

function Test-IntelNPU {
    try {
        # Step 1: Check if CPU SKU has NPU (contains Ultra keyword)
        $intelCPU = (Get-CimInstance -ClassName Win32_Processor).Name
        
        if ($intelCPU -like "*Intel(R) Core(TM) Ultra*") {
            Write-Output-With-Logging "✅ Intel Core Ultra CPU detected: $intelCPU" "Green"
            
            # Step 2: Check if NPU driver is discovered
            $npuDevice = Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { 
                $_.ClassGuid -ne $null -and 
                ($_.PNPClass -eq "ComputeAccelerator" -or $_.FriendlyName -like "*NPU*") 
            } | Select-Object Name, Manufacturer, DeviceID, PNPClass, DriverVersion
            
            if ($npuDevice) {
                Write-Output-With-Logging "✅ Intel NPU driver detected: $($npuDevice.Name)" "Green"

                if (-not $Verbose -and $script:MainLogFile) {
                    "Intel NPU found: $($npuDevice.Name), Driver: $($npuDevice.DriverVersion), Manufacturer: $($npuDevice.Manufacturer)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                    "NPU Device ID: $($npuDevice.DeviceID)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                }
                return $true
            } else {
                # Step 3: NPU not discovered even though CPU has NPU capability
                Write-Output-With-Logging "⚠️  WARNING: Intel NPU driver not detected!" "Yellow"
                Write-Output-With-Logging "" "White"
                Write-Output-With-Logging "   Your CPU supports NPU, but the driver is not installed or detected." "Yellow"
                Write-Output-With-Logging "   Please download and install Intel NPU Driver from:" "Yellow"
                Write-Output-With-Logging "   https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html" "Cyan"
                Write-Output-With-Logging "" "White"
                Write-Output-With-Logging "   You can continue setup, but NPU-accelerated features may not work." "Yellow"
                Write-Output-With-Logging "" "White"
                
                if (-not $Verbose -and $script:MainLogFile) {
                    "WARNING: Intel NPU driver not detected for CPU: $intelCPU" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                }
                
                if (-not $AutoYes) {
                    Read-Host "Press Enter to continue or press CTRL+C to abort setup and install the drivers first..."
                } else {
                    Write-Output-With-Logging "   Auto-accepting to continue (non-interactive mode)..." "Yellow"
                }
                return $false
            }
        } else {
            Write-Output-With-Logging "ℹ️  Intel Core Ultra CPU not detected (NPU not available on this system)" "DarkGray"
            if (-not $Verbose -and $script:MainLogFile) {
                "INFO: CPU does not have NPU capability: $intelCPU" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            }
            return $false
        }
    } catch {
        Write-Output-With-Logging "⚠️  WARNING: Unable to detect NPU information: $($_.Exception.Message)" "Yellow"
        if (-not $Verbose -and $script:MainLogFile) {
            "WARNING: NPU detection failed: $($_.Exception.Message)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
        return $false
    }
}


# Function to run setup for a service
function Invoke-ServiceSetup {
    param([string]$ServicePath, [string]$ServiceName)
    
    Write-ColorOutput "Setting up $ServiceName at $($ServicePath -replace [regex]::Escape($SCRIPT_DIR) + '\\', '')" "Yellow"
    
    # Check if setup.ps1 exists
    $setupScript = Join-Path $ServicePath "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        Write-ColorOutput "Warning: setup.ps1 not found in $ServicePath" "Yellow"
        return [PSCustomObject]@{ 
            Success = $false
            ErrorMessage = "setup.ps1 not found"
            ExitCode = -1 
        }
    }
    
    try {
        # Build arguments for the setup script
        $scriptArgs = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $setupScript
        )
        
        # Always add -Verbose to child scripts for detailed logs
        # In non-verbose mode, this ensures logs are detailed while console stays clean
        $scriptArgs += "-Verbose"
        
        # Add skip parameters for workers setup
        if ($ServiceName -eq "Workers") {
            if ($ContinueOnError) { $scriptArgs += "-ContinueOnError" }
        }
        
        # Create service-specific log file
        $serviceLogFile = Get-ServiceLog -ServiceName $ServiceName
        
        if ($Verbose) {
            # In verbose mode, show output directly in the console (and also log to file)
            Write-ColorOutput "Output is being logged to: $serviceLogFile" "White"
            
            # Redirect output to both console and log file
            $setupProcess = Start-Process -FilePath "powershell.exe" `
                -ArgumentList $scriptArgs `
                -WorkingDirectory $ServicePath `
                -PassThru `
                -NoNewWindow `
                -Wait `
                -RedirectStandardOutput $serviceLogFile `
                -RedirectStandardError "${serviceLogFile}.err"
            
            # Display the log content to console
            if (Test-Path $serviceLogFile) {
                Get-Content $serviceLogFile | Write-Host
            }
            if (Test-Path "${serviceLogFile}.err") {
                Get-Content "${serviceLogFile}.err" | Write-Host
            }
            
            # Check the exit code
            if ($setupProcess.ExitCode -eq 0) {
                Write-ColorOutput "✅ $ServiceName setup completed successfully!" "Green"
                return [PSCustomObject]@{ 
                    Success = $true
                    ErrorMessage = ""
                    ExitCode = $setupProcess.ExitCode 
                }
            } else {
                $errorMsg = "failed with exit code $($setupProcess.ExitCode)"
                Write-ColorOutput "❌ $ServiceName setup failed with exit code $($setupProcess.ExitCode)!" "Red"
                return [PSCustomObject]@{ 
                    Success = $false
                    ErrorMessage = $errorMsg
                    ExitCode = $setupProcess.ExitCode 
                }
            }
        } else {
            # In non-verbose mode
            "=== $ServiceName Setup Log - $(Get-Date) ===" | Out-File -FilePath $serviceLogFile -Encoding utf8
            "" | Out-File -FilePath $serviceLogFile -Append -Encoding utf8
            
            # For Workers, capture verbose output to log but show summary on console
            if ($ServiceName -eq "Workers") {
                Write-ColorOutput "Setting up Workers (logging verbose output to: $serviceLogFile)..." "Yellow"
                Write-Host ""
                
                # Run with output redirection to capture verbose details in log
                $errorLogFile = "${serviceLogFile}.err"
                $setupProcess = Start-Process -FilePath "powershell.exe" `
                    -ArgumentList $scriptArgs `
                    -WorkingDirectory $ServicePath `
                    -PassThru `
                    -NoNewWindow `
                    -Wait `
                    -RedirectStandardOutput $serviceLogFile `
                    -RedirectStandardError $errorLogFile
                
                # Extract and display the summary/results from the log
                if (Test-Path $serviceLogFile) {
                    $logContent = Get-Content $serviceLogFile -Raw -Encoding UTF8
                    
                    # Display the summary section
                    $matchResult = $logContent -match "(?s)(===\s+(?:Partial\s+)?Setup Summary\s+===.*?)(===================)"
                    if ($matchResult) {
                        Write-ColorOutput "Workers Setup Results:" "Cyan"
                        Write-Host ""
                        $summaryText = $matches[1].TrimEnd()
                        $separatorLine = $matches[2]
                        Write-Host $summaryText
                        Write-ColorOutput $separatorLine "Cyan"
                        Write-Host ""
                    }
                    
                    # Display the failure box if present (workers script prints this)
                    $failureBox = $logContent -match "(?s)(╔════════.*?WORKERS SETUP FAILED.*?╚════════[^`n]*)"
                    if ($failureBox) {
                        Write-Host $matches[1]
                        Write-Host ""
                    }
                }
                
                # Check the exit code
                if ($setupProcess.ExitCode -eq 0) {
                    $returnObj = [PSCustomObject]@{ 
                        Success = $true
                        ErrorMessage = ""
                        ExitCode = $setupProcess.ExitCode 
                    }
                    Write-ColorOutput "[OK] $ServiceName setup completed successfully!" "Green"
                    Write-ColorOutput "[LOG] Verbose log available at: $serviceLogFile" "DarkGray"
                    return $returnObj
                } else {
                    $errorMsg = "One or more workers failed (exit code $($setupProcess.ExitCode))"
                    
                    Write-ColorOutput "❌ $ServiceName setup failed!" "Red"
                    Write-ColorOutput "📋 Verbose log available at: $serviceLogFile" "Yellow"
                    if (Test-Path $errorLogFile) {
                        Write-ColorOutput "📋 Error log available at: $errorLogFile" "Yellow"
                    }
                    return [PSCustomObject]@{ 
                        Success = $false
                        ErrorMessage = $errorMsg
                        ExitCode = $setupProcess.ExitCode 
                    }
                }
            } else {
                # For other services, capture verbose output to log, show clean console output
                Write-ColorOutput "Setting up $ServiceName (logging verbose output to: $serviceLogFile)..." "Yellow"
                
                # Run with output redirection to capture verbose details in log
                $errorLogFile = "${serviceLogFile}.err"
                $setupProcess = Start-Process -FilePath "powershell.exe" `
                    -ArgumentList $scriptArgs `
                    -WorkingDirectory $ServicePath `
                    -PassThru `
                    -NoNewWindow `
                    -Wait `
                    -RedirectStandardOutput $serviceLogFile `
                    -RedirectStandardError $errorLogFile
                
                # Check the exit code
                if ($setupProcess.ExitCode -eq 0) {
                    Write-ColorOutput "✅ $ServiceName setup completed successfully!" "Green"
                    Write-ColorOutput "📋 Verbose log available at: $serviceLogFile" "DarkGray"
                    return [PSCustomObject]@{ 
                        Success = $true
                        ErrorMessage = ""
                        ExitCode = $setupProcess.ExitCode 
                    }
                } else {
                    $errorMsg = "failed with exit code $($setupProcess.ExitCode)"
                    Write-ColorOutput "❌ $ServiceName setup failed with exit code $($setupProcess.ExitCode)!" "Red"
                    Write-ColorOutput "📋 Verbose log available at: $serviceLogFile" "Yellow"
                    if (Test-Path $errorLogFile) {
                        Write-ColorOutput "📋 Error log available at: $errorLogFile" "Yellow"
                    }
                    return [PSCustomObject]@{ 
                        Success = $false
                        ErrorMessage = $errorMsg
                        ExitCode = $setupProcess.ExitCode 
                    }
                }
            }
        }
        
    } catch {
        $errorMsg = $_.Exception.Message
        Write-ColorOutput "Setup failed for $ServiceName`: $errorMsg" "Red"
        return [PSCustomObject]@{ 
            Success = $false
            ErrorMessage = $errorMsg
            ExitCode = -1 
        }
    }
}

# Define service configuration
# Note: Electron is skipped by default unless -EnableElectron is specified
$services = @(
    @{Name = "Workers"; Path = "workers"; Skip = $SkipWorkers},
    @{Name = "Frontend"; Path = "frontend"; Skip = $SkipFrontend},
    @{Name = "Electron"; Path = "electron"; Skip = (-not $EnableElectron)}
)

# Main script
Write-ColorOutput "=== Digital Avatar Services Setup ===" "Cyan"
foreach ($service in $services) {
    if ($service.Name -eq "Electron" -and $service.Skip) {
        Write-ColorOutput "$($service.Name) (skipped by default - use -EnableElectron to include)" "DarkGray"
    } else {
        Write-ColorOutput "$($service.Name)" "White"
    }
}
Write-ColorOutput "==========================================" "Cyan"

# Track setup results
$setupResults = @()
$successfulSetups = @()
$failedSetups = @()

try {
    # Setup logging
    Setup-Logging
    
    # Check for Intel GPU driver
    Write-Output-With-Logging "=== Checking system requirements ===" "Cyan"
    $hasIntelGPU = Test-IntelGPU
    $hasIntelNPU = Test-IntelNPU
    Write-Output-With-Logging "" "White"
    
    # Install Node.js first using shared setup_thirdparty.ps1 function
    Write-Output-With-Logging "=== Setting up thirdparty dependencies ===" "Cyan"
    $thirdPartyScript = Join-Path $PROJECT_ROOT 'scripts\win\setup_thirdparty.ps1'
    
    try {
        if (-not $Verbose -and $script:MainLogFile) {
            "Loading thirdparty setup script: $thirdPartyScript" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
        . $thirdPartyScript
        
        if (-not $Verbose -and $script:MainLogFile) {
            "Installing Node.js..." | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
        $nodeExecutable = Install-Node
        
        if (-not $Verbose -and $script:MainLogFile) {
            "Node.js installation completed: $nodeExecutable" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
    } catch {
        $errorMsg = "❌ ERROR: Thirdparty setup failed. Cannot continue with service setup."
        Write-ColorOutput $errorMsg "Red"
        Write-ColorOutput "Please resolve the thirdparty setup issues and try again." "Yellow"
        Write-ColorOutput "Error: $($_.Exception.Message)" "Red"
        
        if (-not $Verbose -and $script:MainLogFile) {
            $errorMsg | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            "Error: $($_.Exception.Message)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            "Stack Trace: $($_.ScriptStackTrace)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
        exit 1
    }
    Write-ColorOutput "" "White"
    
    foreach ($service in $services) {
        if (-not $service.Skip) {
            $setupPath = Join-Path $PROJECT_ROOT "$($service.Path)\setup.ps1"
            if (Test-Path $setupPath) {
                Write-Output-With-Logging "Starting $($service.Name) setup..." "Yellow"
                
                if (-not $Verbose -and $script:MainLogFile) {
                    "Service: $($service.Name), Path: $setupPath" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                }
                
                $result = Invoke-ServiceSetup -ServicePath (Join-Path $PROJECT_ROOT $service.Path) -ServiceName $service.Name
                
                $setupResults += [PSCustomObject]@{
                    ServiceName = $service.Name
                    Success = $result.Success
                    ErrorMessage = $result.ErrorMessage
                    ExitCode = $result.ExitCode
                }
                
                if ($result.Success) {
                    $successfulSetups += $service.Name
                    if (-not $Verbose -and $script:MainLogFile) {
                        "✅ $($service.Name) setup completed successfully" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                    }
                } else {
                    $failedSetups += @{
                        Name = $service.Name
                        Error = $result.ErrorMessage
                        ExitCode = $result.ExitCode
                    }
                    
                    if (-not $Verbose -and $script:MainLogFile) {
                        "❌ $($service.Name) setup failed: $($result.ErrorMessage) (Exit Code: $($result.ExitCode))" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                    }
                    
                    if (-not $ContinueOnError) {
                        Write-ColorOutput "Setup failed for $($service.Name). Use -ContinueOnError to continue with remaining services." "Red"
                        throw "Setup failed for $($service.Name): $($result.ErrorMessage)"
                    } else {
                        Write-ColorOutput "Setup failed for $($service.Name), but continuing with remaining services..." "Yellow"
                    }
                }
            } else {
                Write-Output-With-Logging "Warning: $($service.Name) setup.ps1 not found!" "Yellow"
                $setupResults += [PSCustomObject]@{
                    ServiceName = $service.Name
                    Success = $false
                    ErrorMessage = "setup.ps1 not found"
                    ExitCode = -1
                }
                $failedSetups += @{
                    Name = $service.Name
                    Error = "setup.ps1 not found"
                    ExitCode = -1
                }
                
                if (-not $Verbose -and $script:MainLogFile) {
                    "❌ Setup script not found for $($service.Name) at: $setupPath" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                }
                
                if (-not $ContinueOnError) {
                    throw "Setup script not found for $($service.Name)"
                } else {
                    Write-ColorOutput "Setup script not found for $($service.Name), but continuing with remaining services..." "Yellow"
                }
            }
        } else {
            Write-Output-With-Logging "Skipping $($service.Name) setup..." "Yellow"
            $setupResults += [PSCustomObject]@{
                ServiceName = $service.Name
                Success = $null  # Indicates skipped
                ErrorMessage = "Skipped by user"
                ExitCode = 0
            }
            if (-not $Verbose -and $script:MainLogFile) {
                "⏭️  Skipped $($service.Name) setup (user requested)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            }
        }
    }
    
    # Display summary
    Write-Output-With-Logging "`n=== Setup Summary ===" "Cyan"
    
    if ($successfulSetups.Count -gt 0) {
        Write-Output-With-Logging "✅ Successful setups ($($successfulSetups.Count)):" "Green"
        foreach ($success in $successfulSetups) {
            Write-Output-With-Logging "  - $success" "Green"
        }
    }
    
    if ($failedSetups.Count -gt 0) {
        Write-Output-With-Logging "❌ Failed setups ($($failedSetups.Count)):" "Red"
        foreach ($failure in $failedSetups) {
            Write-Output-With-Logging "  - $($failure.Name): $($failure.Error) (Exit Code: $($failure.ExitCode))" "Red"
        }
    }
    
    $skippedCount = ($setupResults | Where-Object { $_.Success -eq $null }).Count
    if ($skippedCount -gt 0) {
        Write-Output-With-Logging "⏭️  Skipped setups ($skippedCount):" "Yellow"
        foreach ($result in ($setupResults | Where-Object { $_.Success -eq $null })) {
            Write-Output-With-Logging "  - $($result.ServiceName)" "Yellow"
        }
    }
    
    Write-Output-With-Logging "===================" "Cyan"
    
    # Final status
    if ($failedSetups.Count -eq 0) {
        Write-Output-With-Logging "All setup processes completed successfully!" "Green"
        if (-not $Verbose -and $script:MainLogFile) {
            "`nSetup completed at $(Get-Date)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        }
    } else {
        Write-Output-With-Logging "Some setup processes failed. Check the summary above for details." "Red"
        if (-not $Verbose) {
            Write-ColorOutput "Check individual service logs in $LOG_DIR for detailed error information." "Yellow"
            if ($script:MainLogFile) {
                "`nSetup failed at $(Get-Date)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
                "Check individual service logs for detailed error information." | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
            }
        }
        exit 1
    }
    
} catch {
    $errorMessage = "Error occurred: $($_.Exception.Message)"
    Write-ColorOutput $errorMessage "Red"
    
    if (-not $Verbose -and $script:MainLogFile) {
        $errorMessage | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
        "Stack trace: $($_.ScriptStackTrace)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
    }
    
    if ($Verbose) {
        Write-ColorOutput "Stack trace: $($_.ScriptStackTrace)" "Red"
    }
    
    # Display partial summary if any setups were completed
    if ($setupResults.Count -gt 0) {
        Write-Output-With-Logging "`n=== Partial Setup Summary ===" "Cyan"
        foreach ($result in $setupResults) {
            if ($result.Success -eq $true) {
                Write-Output-With-Logging "✅ $($result.ServiceName): Success" "Green"
            } elseif ($result.Success -eq $false) {
                Write-Output-With-Logging "❌ $($result.ServiceName): $($result.ErrorMessage)" "Red"
            } else {
                Write-Output-With-Logging "⏭️  $($result.ServiceName): Skipped" "Yellow"
            }
        }
        Write-Output-With-Logging "===================" "Cyan"
    }
    
    if (-not $Verbose -and $script:MainLogFile) {
        "`nSetup terminated with error at $(Get-Date)" | Out-File -FilePath $script:MainLogFile -Append -Encoding utf8
    }
    
    exit 1
} finally {
    Cleanup
    
    # Restore original directory
    Pop-Location
}