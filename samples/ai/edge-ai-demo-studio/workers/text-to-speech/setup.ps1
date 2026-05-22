# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot

$SuccessCount = 0
$FailCount = 0
$Results = @()

Push-Location $ScriptDir
try {
    Write-Host "Starting Text-to-Speech setup..." -ForegroundColor Cyan

    $ChildDirs = Get-ChildItem -Path $ScriptDir -Directory

    foreach ($ChildDir in $ChildDirs) {
        $ChildName = $ChildDir.Name
        $SetupScript = Join-Path $ChildDir.FullName "setup.ps1"

        if (-not (Test-Path $SetupScript)) {
            Write-Host "Skipping $ChildName (no setup.ps1 found)" -ForegroundColor Yellow
            continue
        }

        Write-Host "Running setup for $ChildName..." -ForegroundColor Yellow
        Push-Location $ChildDir.FullName
        try {
            & $SetupScript
            if ($LASTEXITCODE -ne 0) {
                throw "Exit code $LASTEXITCODE"
            }
            Write-Host "$ChildName setup completed." -ForegroundColor Green
            $SuccessCount++
            $Results += @{ Name = $ChildName; Status = "success"; Error = $null }
        } catch {
            Write-Host "$ChildName setup failed: $($_.Exception.Message)" -ForegroundColor Red
            $FailCount++
            $Results += @{ Name = $ChildName; Status = "failed"; Error = $_.Exception.Message }
        } finally {
            Pop-Location
        }
    }

    # Summary
    Write-Host ""
    Write-Host "=== Text-to-Speech Setup Summary ===" -ForegroundColor Cyan
    foreach ($r in $Results) {
        if ($r.Status -eq "success") {
            Write-Host "  [OK] $($r.Name)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] $($r.Name): $($r.Error)" -ForegroundColor Red
        }
    }

    if ($FailCount -gt 0) {
        Write-Host "Text-to-Speech setup completed with $FailCount error(s)." -ForegroundColor Red
        exit 1
    }

    Write-Host "Text-to-Speech setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Text-to-Speech setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
