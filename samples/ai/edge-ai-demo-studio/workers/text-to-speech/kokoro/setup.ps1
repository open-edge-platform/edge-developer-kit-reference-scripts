# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = Split-Path (Split-Path $ScriptDir -Parent) -Parent
$WorkersThirdPartyDir = Join-Path $WorkersDir "thirdparty"
$RootDir = Split-Path $WorkersDir -Parent
$RootThirdPartyDir = Join-Path $RootDir "thirdparty"

$UVPath = Join-Path $WorkersThirdPartyDir "uv\uv.exe"
$GitPath = Join-Path $RootThirdPartyDir "git\cmd\git.exe"

$RepoUrl = "https://github.com/hexgrad/kokoro.git"
$RepoCommit = "dfb907a02bba8152ca444717ca5d78747ccb4bec"
$DestDir = Join-Path $ScriptDir "kokoro"

function Test-UV {
    if (Test-Path $UVPath) {
        Write-Host "Found uv."
        return
    }
    Write-Host "ERROR: uv not found at $UVPath" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Test-Git {
    if (Test-Path $GitPath) {
        return
    }
    Write-Host "ERROR: git not found at $GitPath" -ForegroundColor Red
    Write-Host "Please run the main setup script first." -ForegroundColor Red
    exit 1
}

function Install-KokoroRepo {
    Write-Host "Preparing kokoro at $DestDir..."

    if ((Test-Path $DestDir) -and (Get-ChildItem $DestDir -Force).Count -gt 0) {
        Write-Host "Destination $DestDir already exists. Skipping clone."
        return
    }

    Write-Host "Cloning commit $RepoCommit from $RepoUrl..."
    & $GitPath init $DestDir
    if ($LASTEXITCODE -ne 0) { throw "git init failed (exit code $LASTEXITCODE)" }

    Push-Location $DestDir
    try {
        & $GitPath remote add origin $RepoUrl
        if ($LASTEXITCODE -ne 0) { throw "git remote add failed (exit code $LASTEXITCODE)" }

        try {
            & $GitPath fetch --depth 1 origin $RepoCommit
            if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }
            & $GitPath checkout FETCH_HEAD
            if ($LASTEXITCODE -ne 0) { throw "git checkout failed" }
        } catch {
            Write-Host "Warning: could not fetch commit directly. Falling back to shallow clone."
            & $GitPath fetch --depth 1 origin
            if ($LASTEXITCODE -ne 0) { throw "git fetch failed (exit code $LASTEXITCODE)" }
            try {
                & $GitPath checkout --detach FETCH_HEAD
                if ($LASTEXITCODE -ne 0) { throw "git checkout --detach failed" }
            } catch {
                & $GitPath checkout --force
                if ($LASTEXITCODE -ne 0) { throw "git checkout --force failed (exit code $LASTEXITCODE)" }
            }
        }

        $PatchFile = Join-Path $ScriptDir "kokoro.patch"
        if (Test-Path $PatchFile) {
            Write-Host "Applying local patch: $PatchFile"
            try {
                & $GitPath apply --whitespace=fix $PatchFile
                & $GitPath add -A
                try {
                    & $GitPath commit -m "Apply local kokoro.patch" --author="Edge AI Demo Studio <no-reply@local>"
                    Write-Host "Patch applied and committed."
                } catch {
                    # Continue if commit fails (no changes)
                }
            } catch {
                Write-Host "git apply failed; attempting git am fallback..."
                try {
                    Get-Content $PatchFile | & $GitPath am --signoff
                    Write-Host "Patch applied via git am."
                } catch {
                    Write-Host "ERROR: Failed to apply patch. Aborting." -ForegroundColor Red
                    try { & $GitPath am --abort } catch { }
                    Pop-Location
                    throw "Patch application failed"
                }
            }
        } else {
            Write-Host "No local patch file found; skipping patch step."
        }

        Write-Host "Pruning repository: keeping only the 'kokoro' folder..."
        $itemsToRemove = Get-ChildItem -Force | Where-Object { $_.Name -ne "kokoro" -and $_.Name -ne "." -and $_.Name -ne ".." }
        foreach ($item in $itemsToRemove) {
            try { Remove-Item -Path $item.FullName -Recurse -Force } catch { }
        }

        if (Test-Path "kokoro") {
            Write-Host "Moving kokoro contents to top level..."
            $kokoroItems = Get-ChildItem -Path "kokoro" -Force
            if ($kokoroItems.Count -gt 0) {
                foreach ($item in $kokoroItems) {
                    try { Move-Item -Path $item.FullName -Destination . -Force } catch { }
                }
            }
            Remove-Item -Path "kokoro" -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Write-Host "Warning: expected 'kokoro' directory not found in fetched repo."
        }

        if (Test-Path ".git") {
            Remove-Item -Path ".git" -Recurse -Force
        }

        Write-Host "Kokoro prepared at $DestDir."
    } finally {
        Pop-Location
    }
}

function Setup-ExportVenv {
    Write-Host "Setting up export virtual environment (.export-venv)..."
    & $UVPath venv --seed (Join-Path $ScriptDir ".export-venv")
    if ($LASTEXITCODE -ne 0) { throw "uv venv failed (exit code $LASTEXITCODE)" }

    & $UVPath pip install `
        --python (Join-Path $ScriptDir ".export-venv\Scripts\python.exe") `
        -q `
        "kokoro>=0.8.2" `
        "misaki[en]>=0.8.2" `
        "soundfile" `
        "psutil" `
        "modelscope" `
        "transformers==4.53.3" `
        "torch<2.9" `
        "openvino>=2025.3.0" `
        "click>=8.3.3" `
        --extra-index-url "https://download.pytorch.org/whl/cpu"
    if ($LASTEXITCODE -ne 0) { throw "uv pip install failed (exit code $LASTEXITCODE)" }
    Write-Host "Export virtual environment ready."
}

Push-Location $ScriptDir
try {
    Write-Host "Starting Kokoro setup..." -ForegroundColor Cyan
    Test-UV
    Test-Git
    Install-KokoroRepo
    Setup-ExportVenv
    Write-Host "Kokoro setup completed successfully!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "Kokoro setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}