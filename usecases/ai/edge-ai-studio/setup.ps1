# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Parameters for switches and options
param(
    [switch]$SkipLLM,
    [switch]$SkipTTS,
    [switch]$SkipFrontend,
    [switch]$SkipElectron,
    [switch]$Verbose
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
    
    # Check if setup.ps1 exists
    $setupScript = Join-Path $ServicePath "setup.ps1"
    if (-not (Test-Path $setupScript)) {
        throw "setup.ps1 not found in $ServicePath"
    }
    
    try {
        Write-ColorOutput "=== $ServiceName Setup Started ===" "Cyan"
        
        # Build arguments for the setup script
        $scriptArgs = @("-File", $setupScript)
        
        # Add skip parameters for workers setup
        if ($ServiceName -eq "Workers") {
            if ($SkipLLM) { $scriptArgs += "-SkipLLM" }
            if ($SkipTTS) { $scriptArgs += "-SkipTTS" }
            if ($Verbose) { $scriptArgs += "-Verbose" }
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
        } else {
            Write-ColorOutput "$ServiceName setup failed with exit code $($setupProcess.ExitCode)!" "Red"
            throw "Setup failed for $ServiceName with exit code $($setupProcess.ExitCode)"
        }
        
        return $setupProcess
    } catch {
        Write-ColorOutput "Setup failed for $ServiceName`: $($_.Exception.Message)" "Red"
        throw
    }
}

# Define service configuration
$services = @(
    @{Name = "Workers"; Path = "workers"; Skip = $false},
    @{Name = "Frontend"; Path = "frontend"; Skip = $SkipFrontend},
    @{Name = "Electron"; Path = "electron"; Skip = $SkipElectron}
)

# Main script
Write-ColorOutput "=== Digital Avatar Services Setup ===" "Cyan"
foreach ($service in $services) {
    Write-ColorOutput "$($service.Name)" "White"
}
Write-ColorOutput "==========================================" "Cyan"

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
                try {
                    $setupProcess = Invoke-ServiceSetup -ServicePath (Join-Path $PWD $service.Path) -ServiceName $service.Name
                } catch {
                    Write-ColorOutput "$($service.Name) setup failed: $($_.Exception.Message)" "Red"
                    throw
                }
            } else {
                Write-ColorOutput "Warning: $($service.Name) setup.ps1 not found!" "Yellow"
            }
        }
    }
    
    Write-ColorOutput "All setup processes completed successfully!" "Green"
} catch {
    Write-ColorOutput "Error occurred: $($_.Exception.Message)" "Red"
    if ($Verbose) {
        Write-ColorOutput "Stack trace: $($_.ScriptStackTrace)" "Red"
    }
} finally {
    Cleanup
}