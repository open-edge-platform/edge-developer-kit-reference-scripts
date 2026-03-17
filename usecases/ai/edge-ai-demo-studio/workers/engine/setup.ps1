#!/usr/bin/env pwsh
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Setup script to run setup.ps1 in all 1-level child directories
# This script will execute setup.ps1 files in subdirectories like kokoro/, malaya/, etc.

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"  # Exit on any error

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Write-Host "Running setup for engine workers from: $ScriptDir" -ForegroundColor Green

# Track setup results
$script:SetupResults = @()
$script:SuccessCount = 0
$script:FailCount = 0

# Function to run setup in a child directory
function Invoke-ChildSetup {
    param(
        [string]$ChildDir
    )
    
    $ChildName = Split-Path -Leaf $ChildDir
    $SetupScript = Join-Path $ChildDir "setup.bat"
    
    if (Test-Path $SetupScript) {
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "Running setup for: $ChildName" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Cyan
        
        # Change to the child directory and run setup
        Push-Location $ChildDir
        try {
            & $SetupScript
            if ($LASTEXITCODE -ne 0) {
                throw "Setup script failed for $ChildName with exit code $LASTEXITCODE"
            }
            Write-Host "✅ Setup completed for: $ChildName" -ForegroundColor Green
            Write-Host ""
            $script:SetupResults += @{ Name = $ChildName; Success = $true; Error = $null }
            $script:SuccessCount++
        }
        catch {
            Write-Host "❌ Setup failed for: $ChildName" -ForegroundColor Red
            Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host ""
            $script:SetupResults += @{ Name = $ChildName; Success = $false; Error = $_.Exception.Message }
            $script:FailCount++
            throw
        }
        finally {
            # Return to the original directory
            Pop-Location
        }
    }
    else {
        Write-Host "Warning: No setup.bat found in $ChildDir" -ForegroundColor Yellow
        $script:SetupResults += @{ Name = $ChildName; Success = $null; Error = "No setup.bat found" }
    }
}

# Main execution with comprehensive error handling
try {
    # Find all 1-level child directories and run their setup scripts
    $ChildDirectories = Get-ChildItem -Path $ScriptDir -Directory -ErrorAction Stop
    
    if ($ChildDirectories.Count -eq 0) {
        Write-Host "No child directories found to set up." -ForegroundColor Yellow
        exit 0
    }
    
    foreach ($ChildDir in $ChildDirectories) {
        try {
            Invoke-ChildSetup -ChildDir $ChildDir.FullName
        }
        catch {
            # Error already logged in Invoke-ChildSetup, continue with next
            Write-Host "Continuing with remaining engine workers..." -ForegroundColor Yellow
        }
    }

    # Display summary
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Engine Setup Summary" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    if ($script:SuccessCount -gt 0) {
        Write-Host "✅ Successful: $script:SuccessCount" -ForegroundColor Green
        foreach ($result in ($script:SetupResults | Where-Object { $_.Success -eq $true })) {
            Write-Host "   - $($result.Name)" -ForegroundColor Green
        }
    }
    
    if ($script:FailCount -gt 0) {
        Write-Host "❌ Failed: $script:FailCount" -ForegroundColor Red
        foreach ($result in ($script:SetupResults | Where-Object { $_.Success -eq $false })) {
            Write-Host "   - $($result.Name): $($result.Error)" -ForegroundColor Red
        }
    }
    
    $skippedResults = $script:SetupResults | Where-Object { $_.Success -eq $null }
    if ($skippedResults.Count -gt 0) {
        Write-Host "⏭️  Skipped: $($skippedResults.Count)" -ForegroundColor Yellow
        foreach ($result in $skippedResults) {
            Write-Host "   - $($result.Name): $($result.Error)" -ForegroundColor Yellow
        }
    }
    
    Write-Host "========================================" -ForegroundColor Cyan
    
    if ($script:FailCount -gt 0) {
        Write-Host "Engine setup completed with errors." -ForegroundColor Red
        exit 1
    } else {
        Write-Host "All engine setup scripts completed successfully!" -ForegroundColor Green
        exit 0
    }
} catch {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "❌ FATAL ERROR in engine setup" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($Verbose -and $_.ScriptStackTrace) {
        Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
    }
    exit 1
}
