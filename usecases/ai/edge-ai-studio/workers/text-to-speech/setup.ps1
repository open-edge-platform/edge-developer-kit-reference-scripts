#!/usr/bin/env pwsh
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Setup script to run setup.ps1 in all 1-level child directories
# This script will execute setup.ps1 files in subdirectories like kokoro/, malaya/, etc.

$ErrorActionPreference = "Stop"  # Exit on any error

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Write-Host "Running setup for text-to-speech workers from: $ScriptDir" -ForegroundColor Green

# Function to run setup in a child directory
function Invoke-ChildSetup {
    param(
        [string]$ChildDir
    )
    
    $SetupScript = Join-Path $ChildDir "setup.ps1"
    
    if (Test-Path $SetupScript) {
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "Running setup for: $(Split-Path -Leaf $ChildDir)" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Cyan
        
        # Change to the child directory and run setup
        Push-Location $ChildDir
        try {
            & $SetupScript
        }
        finally {
            # Return to the original directory
            Pop-Location
        }
        
        Write-Host "Setup completed for: $(Split-Path -Leaf $ChildDir)" -ForegroundColor Green
        Write-Host ""
    }
    else {
        Write-Host "Warning: No setup.ps1 found in $ChildDir" -ForegroundColor Yellow
    }
}

# Find all 1-level child directories and run their setup scripts
$ChildDirectories = Get-ChildItem -Path $ScriptDir -Directory
foreach ($ChildDir in $ChildDirectories) {
    Invoke-ChildSetup -ChildDir $ChildDir.FullName
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "All text-to-speech setup scripts completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
