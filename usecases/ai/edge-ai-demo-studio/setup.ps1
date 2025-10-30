# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Parameters for switches and options
param(
    [switch]$SkipWorkers,
    [switch]$SkipFrontend,
    [switch]$SkipElectron,
    [switch]$Verbose,
    [switch]$ContinueOnError  # Continue setup for remaining services even if one fails
)

# Helper: Cleanup processes
function Cleanup {
    Write-ColorOutput "`nCleaning up jobs..." "Yellow"
    Get-Job | Stop-Job -ErrorAction SilentlyContinue
    Get-Job | Remove-Job -ErrorAction SilentlyContinue
    Write-ColorOutput "Cleanup completed." "Green"
}
Register-EngineEvent PowerShell.Exiting -Action { Cleanup }

# Set error action preference
$ErrorActionPreference = "Stop"

# Function to write colored output
function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}


# Function to run setup for a service
function Invoke-ServiceSetup {
    param([string]$ServicePath, [string]$ServiceName)
    
    Write-ColorOutput "Running setup for $ServiceName..." "Yellow"
    
    # Debug output for verbose mode
    if ($Verbose) {
        Write-ColorOutput "Verbose mode enabled for $ServiceName" "Magenta"
    }
    
    # Check if setup.ps1 exists
    $setupScript = Join-Path $ServicePath "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        Write-ColorOutput "Warning: setup.ps1 not found in $ServicePath" "Yellow"
        return @{ Success = $false; ErrorMessage = "setup.ps1 not found"; ExitCode = -1 }
    }
    
    try {
        Write-ColorOutput "=== $ServiceName Setup Started ===" "Cyan"
        
        # Build arguments for the setup script
        $scriptArgs = @("-File", $setupScript)
        
        # Add common parameters to all services
        if ($Verbose) { $scriptArgs += "-Verbose" }
        
        # Add skip parameters for workers setup
        if ($ServiceName -eq "Workers") {
            if ($ContinueOnError) { $scriptArgs += "-ContinueOnError" }
        }
        
        if ($Verbose) {
            # In verbose mode, show output directly in the same window
            $setupProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $scriptArgs -WorkingDirectory $ServicePath -PassThru -NoNewWindow -Wait
        } else {
            # In non-verbose mode, show filtered/summarized output
            Write-ColorOutput "This may take several minutes depending on your internet connection..." "White"
            Write-ColorOutput "Use -Verbose to see detailed output." "White"
            
            # Create a job to run the setup script so we can monitor it
            $job = Start-Job -ScriptBlock {
                param($ScriptArgs, $WorkingDirectory)
                $process = Start-Process -FilePath "powershell.exe" -ArgumentList $ScriptArgs -WorkingDirectory $WorkingDirectory -PassThru -WindowStyle Hidden -Wait
                return $process.ExitCode
            } -ArgumentList $scriptArgs, $ServicePath
            
            # Show progress dots while waiting
            $dotCount = 0
            while ($job.State -eq "Running") {
                Start-Sleep -Seconds 2
                Write-Host "." -NoNewline -ForegroundColor Yellow
                $dotCount++
                if ($dotCount % 30 -eq 0) {
                    Write-Host "`n$ServiceName setup still running..." -ForegroundColor Yellow
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
            Write-ColorOutput "$ServiceName setup completed successfully!" "Green"
            return @{ Success = $true; ErrorMessage = $null; ExitCode = $setupProcess.ExitCode }
        } else {
            $errorMsg = "Setup failed with exit code $($setupProcess.ExitCode)"
            Write-ColorOutput "$ServiceName setup failed with exit code $($setupProcess.ExitCode)!" "Red"
            return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = $setupProcess.ExitCode }
        }
        
    } catch {
        $errorMsg = $_.Exception.Message
        Write-ColorOutput "Setup failed for $ServiceName`: $errorMsg" "Red"
        return @{ Success = $false; ErrorMessage = $errorMsg; ExitCode = -1 }
    }
}

# Define service configuration
$services = @(
    @{Name = "Workers"; Path = "workers"; Skip = $SkipWorkers},
    @{Name = "Frontend"; Path = "frontend"; Skip = $SkipFrontend},
    @{Name = "Electron"; Path = "electron"; Skip = $SkipElectron}
)

# Main script
Write-ColorOutput "=== Digital Avatar Services Setup ===" "Cyan"
foreach ($service in $services) {
    Write-ColorOutput "$($service.Name)" "White"
}
Write-ColorOutput "==========================================" "Cyan"

# Track setup results
$setupResults = @()
$successfulSetups = @()
$failedSetups = @()

try {
    # Install Node.js first using shared setup_thirdparty.ps1 function
    $thirdPartyScript = Join-Path $PSScriptRoot 'scripts\setup_thirdparty.ps1'
    . $thirdPartyScript
    $nodeExecutable = Install-Node
    
    foreach ($service in $services) {
        if (-not $service.Skip) {
            $setupPath = Join-Path $PWD "$($service.Path)\setup.ps1"
            if (Test-Path $setupPath) {
                Write-ColorOutput "Starting $($service.Name) setup..." "Yellow"
                
                $result = Invoke-ServiceSetup -ServicePath (Join-Path $PWD $service.Path) -ServiceName $service.Name
                $setupResults += @{
                    ServiceName = $service.Name
                    Success = $result.Success
                    ErrorMessage = $result.ErrorMessage
                    ExitCode = $result.ExitCode
                }
                
                if ($result.Success) {
                    $successfulSetups += $service.Name
                } else {
                    $failedSetups += @{
                        Name = $service.Name
                        Error = $result.ErrorMessage
                        ExitCode = $result.ExitCode
                    }
                    
                    if (-not $ContinueOnError) {
                        Write-ColorOutput "Setup failed for $($service.Name). Use -ContinueOnError to continue with remaining services." "Red"
                        throw "Setup failed for $($service.Name): $($result.ErrorMessage)"
                    } else {
                        Write-ColorOutput "Setup failed for $($service.Name), but continuing with remaining services..." "Yellow"
                    }
                }
            } else {
                Write-ColorOutput "Warning: $($service.Name) setup.ps1 not found!" "Yellow"
                $setupResults += @{
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
                
                if (-not $ContinueOnError) {
                    throw "Setup script not found for $($service.Name)"
                } else {
                    Write-ColorOutput "Setup script not found for $($service.Name), but continuing with remaining services..." "Yellow"
                }
            }
        } else {
            Write-ColorOutput "Skipping $($service.Name) setup..." "Yellow"
            $setupResults += @{
                ServiceName = $service.Name
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
        }
    }
    
    $skippedCount = ($setupResults | Where-Object { $_.Success -eq $null }).Count
    if ($skippedCount -gt 0) {
        Write-ColorOutput "⏭️  Skipped setups ($skippedCount):" "Yellow"
        foreach ($result in ($setupResults | Where-Object { $_.Success -eq $null })) {
            Write-ColorOutput "  - $($result.ServiceName)" "Yellow"
        }
    }
    
    Write-ColorOutput "===================" "Cyan"
    
    # Final status
    if ($failedSetups.Count -eq 0) {
        Write-ColorOutput "All setup processes completed successfully!" "Green"
    } else {
        Write-ColorOutput "Some setup processes failed. Check the summary above for details." "Red"
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
                Write-ColorOutput "✅ $($result.ServiceName): Success" "Green"
            } elseif ($result.Success -eq $false) {
                Write-ColorOutput "❌ $($result.ServiceName): $($result.ErrorMessage)" "Red"
            } else {
                Write-ColorOutput "⏭️  $($result.ServiceName): Skipped" "Yellow"
            }
        }
        Write-ColorOutput "===================" "Cyan"
    }
    
    exit 1
} finally {
    Cleanup
}