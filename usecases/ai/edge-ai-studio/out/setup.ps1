# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit immediately if a command fails
$ErrorActionPreference = "Stop"

# Get the directory of this script
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Resources directory in the packaged application
$RESOURCES_DIR = Join-Path $SCRIPT_DIR "win-unpacked\resources"
$THIRDPARTY_DIR = Join-Path $RESOURCES_DIR "thirdparty"

# Service configurations (Name -> Path:SkipFlag)
$serviceConfigs = @{
    "Workers" = @{
        Path = "workers"
    }
}

function Setup-Services {
    foreach ($serviceName in $serviceConfigs.Keys) {
        $config = $serviceConfigs[$serviceName]
        $servicePath = $config.Path
        
        Set-Location $RESOURCES_DIR
        $serviceSetupFile = "setup.ps1"
        $serviceSetupPath = Join-Path $RESOURCES_DIR "$servicePath\$serviceSetupFile"
        $serviceDir = Join-Path $RESOURCES_DIR $servicePath
        
        if (Test-Path $serviceDir) {
            Set-Location $serviceDir
            Write-Host "Setting up $serviceName at $serviceDir" -ForegroundColor Green
            
            if (Test-Path $serviceSetupPath) {
                if ($serviceName -eq "Workers" -and -not $SkipWorkers) {
                    & powershell.exe -File $serviceSetupPath -SetupWorkers
                } else {
                    & powershell.exe -File $serviceSetupPath
                }
                
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Setup failed for $serviceName" -ForegroundColor Red
                    exit 1
                }
            } else {
                Write-Host "Setup script not found for $serviceName at $serviceSetupPath" -ForegroundColor Red
                exit 1
            }
            Set-Location $RESOURCES_DIR
        } else {
            Write-Host "Directory not found: $serviceDir" -ForegroundColor Red
            exit 1
        }
    }
}

function Main {
    # Check if resources directory exists
    if (-not (Test-Path $RESOURCES_DIR)) {
        Write-Host "Error: Resources directory not found at $RESOURCES_DIR" -ForegroundColor Red
        Write-Host "Make sure you're running this script from the correct location." -ForegroundColor Red
        exit 1
    }
    
    Set-Location $RESOURCES_DIR
    
    # Run third-party setup script if it exists
    $thirdPartySetupScript = Join-Path $RESOURCES_DIR "scripts\setup_thirdparty.ps1"
    if (Test-Path $thirdPartySetupScript) {
        Write-Host "Running third-party setup script..." -ForegroundColor Green
        & powershell.exe -File $thirdPartySetupScript $THIRDPARTY_DIR
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Third-party setup failed" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Warning: Third-party setup script not found at $thirdPartySetupScript" -ForegroundColor Yellow
    }
    
    Setup-Services
    
    Write-Host "Setup completed successfully!" -ForegroundColor Green
}

Main