# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$TTS_SCRIPT_DIR = $PSScriptRoot
$TTS_VENV_DIR = Join-Path $TTS_SCRIPT_DIR ".venv"

# Repo info for kokoro
$REPO_URL = "https://github.com/hexgrad/kokoro.git"
# specific commit hash to fetch (from the tree URL provided)
$REPO_COMMIT = "dfb907a02bba8152ca444717ca5d78747ccb4bec"
$DEST_DIR = Join-Path $TTS_SCRIPT_DIR "kokoro"
$ROOT_THIRDPARTY_DIR = "$TTS_SCRIPT_DIR\..\..\..\thirdparty"
$PARENT_GIT_PATH = "$ROOT_THIRDPARTY_DIR\git\cmd\git.exe"

# Function to check if uv is installed
function Test-UvInstalled {
    Write-Host "Checking if uv is installed in workers thirdparty directory..." -ForegroundColor Yellow
    
    # Use uv from workers thirdparty folder (2 levels up)
    $parentUvPath = Join-Path (Split-Path (Split-Path $PWD -Parent) -Parent) "thirdparty\uv\uv.exe"
    if (Test-Path $parentUvPath) {
        Write-Host "Found uv in workers thirdparty folder." -ForegroundColor Green
        $script:uvCommand = $parentUvPath
        return $true
    } else {
        Write-Host "uv not found in expected location: $parentUvPath" -ForegroundColor Red
        Write-Host "Please ensure the workers setup has been run first." -ForegroundColor Red
        throw "UV not found"
    }
}

function New-VirtualEnvironment {
    if (Test-Path $TTS_VENV_DIR) {
        Write-Host "Virtual environment already exists at $TTS_VENV_DIR." -ForegroundColor Green
    } else {
        Write-Host "Creating Python 3.11 virtual environment with uv ..." -ForegroundColor Yellow
        & $script:uvCommand venv --python 3.11 --seed
    }
    & $script:uvCommand sync
    & $script:uvCommand run python -m ensurepip
}

function Clone-KokoroRepo {
    Write-Host "Preparing kokoro at $DEST_DIR" -ForegroundColor Yellow

    # Check if git is available
    if (-not (Test-Path "$PARENT_GIT_PATH")) {
        Write-Host "Portable git is not found in thirdparty folder, ensure setup script is ran properly"
        throw "Git not found"
    }

    if ((Test-Path $DEST_DIR) -and (Get-ChildItem $DEST_DIR -Force).Count -gt 0) {
        Write-Host "Destination $DEST_DIR already exists and is not empty. Skipping clone." -ForegroundColor Green
        return
    }

    # Initialize a repository and fetch only the specific commit (shallow)
    Write-Host "Cloning specific commit $REPO_COMMIT from $REPO_URL into $DEST_DIR" -ForegroundColor Yellow
    & $PARENT_GIT_PATH init $DEST_DIR
    Push-Location $DEST_DIR
    
    try {
        & $PARENT_GIT_PATH remote add origin $REPO_URL

        # Try to fetch the specific commit shallowly. If that fails, fall back to a shallow branch fetch.
        try {
            & $PARENT_GIT_PATH fetch --depth 1 origin $REPO_COMMIT
            & $PARENT_GIT_PATH checkout FETCH_HEAD
        } catch {
            Write-Host "Warning: could not fetch commit $REPO_COMMIT directly. Falling back to shallow clone of default branch." -ForegroundColor Yellow
            & $PARENT_GIT_PATH fetch --depth 1 origin
            try {
                & $PARENT_GIT_PATH checkout --detach FETCH_HEAD
            } catch {
                & $PARENT_GIT_PATH checkout --force
            }
        }

        # If a local patch file exists next to this script, attempt to apply it now
        $PATCH_FILE = Join-Path $TTS_SCRIPT_DIR "kokoro.patch"
        if (Test-Path $PATCH_FILE) {
            Write-Host "Applying local patch: $PATCH_FILE" -ForegroundColor Yellow
            # Try a clean git apply first (index update) and commit the result. Fail hard if patch can't be applied.
            try {
                & $PARENT_GIT_PATH apply --whitespace=fix $PATCH_FILE
                & $PARENT_GIT_PATH add -A
                # Try to commit; if commit fails (e.g. no changes), continue
                try {
                    & $PARENT_GIT_PATH commit -m "Apply local kokoro.patch" --author="Edge AI Studio <no-reply@local>"
                    Write-Host "Patch applied and committed." -ForegroundColor Green
                } catch {
                    # Continue if commit fails (no changes)
                }
            } catch {
                Write-Host "git apply failed; attempting git am fallback..." -ForegroundColor Yellow
                # git am expects an email-style patch. Try it as a fallback. If it fails, abort and exit to avoid pruning useful files.
                try {
                    Get-Content $PATCH_FILE | & $PARENT_GIT_PATH am --signoff
                    Write-Host "Patch applied via git am." -ForegroundColor Green
                } catch {
                    Write-Host "ERROR: Failed to apply patch $PATCH_FILE. Aborting setup so the repository isn't pruned incorrectly." -ForegroundColor Red
                    try { & $PARENT_GIT_PATH am --abort } catch { }
                    Pop-Location
                    throw "Patch application failed"
                }
            }
        } else {
            Write-Host "No local patch file found at $PATCH_FILE; skipping patch step." -ForegroundColor Yellow
        }

        # Remove everything except the kokoro folder
        Write-Host "Pruning repository: keeping only the 'kokoro' folder" -ForegroundColor Yellow
        # Get all items except kokoro
        $itemsToRemove = Get-ChildItem -Force | Where-Object { $_.Name -ne "kokoro" -and $_.Name -ne "." -and $_.Name -ne ".." }
        foreach ($item in $itemsToRemove) {
            try {
                Remove-Item -Path $item.FullName -Recurse -Force
            } catch {
                # Continue on error
            }
        }

        # If the repo produced a nested kokoro folder (DEST_DIR/kokoro), move its contents up
        if (Test-Path "kokoro") {
            Write-Host "Moving contents of inner 'kokoro' up into $DEST_DIR" -ForegroundColor Yellow
            $kokoroItems = Get-ChildItem -Path "kokoro" -Force
            if ($kokoroItems.Count -gt 0) {
                foreach ($item in $kokoroItems) {
                    try {
                        Move-Item -Path $item.FullName -Destination . -Force
                    } catch {
                        # Continue on error
                    }
                }
            }
            Remove-Item -Path "kokoro" -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Write-Host "Warning: expected 'kokoro' directory not found in fetched repo." -ForegroundColor Yellow
        }

        # Optionally remove .git to leave only the kokoro content in the folder structure
        if (Test-Path ".git") {
            Remove-Item -Path ".git" -Recurse -Force
        }

        Write-Host "kokoro prepared at $DEST_DIR (kokoro files at top level)" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# Main execution
function Main {
    Write-Host "Starting setup for Kokoro FastAPI with Intel GPU support ..." -ForegroundColor Green
    Set-Location $TTS_SCRIPT_DIR
    Test-UvInstalled
    New-VirtualEnvironment
    Clone-KokoroRepo
    Write-Host "Setup completed successfully!" -ForegroundColor Green
}

try {
    Main
    exit 0
} catch {
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to continue..."
    exit 1
}