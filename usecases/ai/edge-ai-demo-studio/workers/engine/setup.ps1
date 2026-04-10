# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot

$SuccessCount = 0
$FailCount = 0
$Results = @()

Push-Location $ScriptDir
try {
    Write-Host "Starting Engine setup..." -ForegroundColor Cyan

    $ChildDirs = Get-ChildItem -Path $ScriptDir -Directory

    foreach ($ChildDir in $ChildDirs) {
        $ChildName = $ChildDir.Name
        $SetupScript = Join-Path $ChildDir.FullName "setup.bat"

        if (-not (Test-Path $SetupScript)) {
            Write-Host "Skipping $ChildName (no setup.bat found)" -ForegroundColor Yellow
            continue
        }

        Write-Host "Running setup for $ChildName..." -ForegroundColor Yellow

        # Prepare to temporarily add Git (thirdparty/git/cmd) to PATH for this child setup
        $OriginalPath = $env:Path
        $GitCmdDir = Join-Path $ScriptDir "..\..\thirdparty\git\cmd"
        $GitCmdDir = [System.IO.Path]::GetFullPath($GitCmdDir)
        $AddedGit = $false
        if (Test-Path $GitCmdDir) {
            $env:Path = "$GitCmdDir;$env:Path"
            $AddedGit = $true
        } else {
            Write-Host "Git not found at $GitCmdDir - continuing without modifying PATH" -ForegroundColor Yellow
        }

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
            Write-Host ($ChildName + " setup failed: " + $_.Exception.Message) -ForegroundColor Red
            $FailCount++
            $Results += @{ Name = $ChildName; Status = "failed"; Error = $_.Exception.Message }
        } finally {
            # Restore PATH if we added Git
            if ($AddedGit) {
                $env:Path = $OriginalPath
            }
            Pop-Location
        }
    }

    # Summary
    Write-Host ""
    Write-Host "=== Engine Setup Summary ===" -ForegroundColor Cyan
    foreach ($r in $Results) {
        if ($r.Status -eq "success") {
            Write-Host "  [OK] $($r.Name)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] $($r.Name): $($r.Error)" -ForegroundColor Red
        }
    }

    if ($FailCount -gt 0) {
        Write-Host "Engine setup completed with $FailCount error(s)." -ForegroundColor Red
        exit 1
    }

    Write-Host "Engine setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host ("Engine setup failed: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
