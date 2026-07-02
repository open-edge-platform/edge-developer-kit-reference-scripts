# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$UV_CMD = Join-Path $SCRIPT_DIR "..\..\thirdparty\uv\uv.exe"
$RootThirdPartyDir = Join-Path (Split-Path (Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent) -Parent) "thirdparty"
$GitPath = Join-Path $RootThirdPartyDir "git\cmd\git.exe"

$REPO_URL = "https://github.com/hexgrad/kokoro.git"
$REPO_COMMIT = "dfb907a02bba8152ca444717ca5d78747ccb4bec"
$KOKORO_DIR = Join-Path $SCRIPT_DIR "kokoro"

function Test-UV {
    if (Test-Path $UV_CMD) { return }
    Write-Host "ERROR: uv not found at $UV_CMD" -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

function Get-GitCmd {
    if (Test-Path $GitPath) { return $GitPath }
    if (Get-Command git -ErrorAction SilentlyContinue) { return "git" }
    Write-Host "ERROR: git not found. Please run the main setup script first." -ForegroundColor Red
    exit 1
}

function Install-KokoroRepo {
    if ((Test-Path $KOKORO_DIR) -and (Get-ChildItem $KOKORO_DIR -Force -ErrorAction SilentlyContinue).Count -gt 0) {
        Write-Host "Kokoro repo already present. Skipping clone."
        return
    }
    Write-Host "Cloning Kokoro repo..."
    $GitCmd = Get-GitCmd
    & $GitCmd init $KOKORO_DIR
    if ($LASTEXITCODE -ne 0) { throw "git init failed" }
    Push-Location $KOKORO_DIR
    try {
        & $GitCmd remote add origin $REPO_URL
        try {
            & $GitCmd fetch --depth 1 origin $REPO_COMMIT
            & $GitCmd checkout FETCH_HEAD
        } catch {
            Write-Host "Warning: direct fetch failed, falling back to shallow clone."
            & $GitCmd fetch --depth 1 origin
            try { & $GitCmd checkout --detach FETCH_HEAD } catch { & $GitCmd checkout --force }
        }
        $PatchFile = Join-Path $SCRIPT_DIR "kokoro.patch"
        if (Test-Path $PatchFile) {
            Write-Host "Applying local patch: $PatchFile"
            try {
                & $GitCmd apply --whitespace=fix $PatchFile
                & $GitCmd add -A
                try { & $GitCmd commit -m "Apply local kokoro.patch" --author="Edge AI Studio <no-reply@local>" } catch {}
            } catch {
                Write-Host "git apply failed; attempting git am fallback..."
                Get-Content $PatchFile | & $GitCmd am --signoff
                if ($LASTEXITCODE -ne 0) { & $GitCmd am --abort; throw "Patch application failed" }
            }
        }
        $itemsToRemove = Get-ChildItem -Force | Where-Object { $_.Name -ne "kokoro" -and $_.Name -ne "." -and $_.Name -ne ".." }
        foreach ($item in $itemsToRemove) { try { Remove-Item $item.FullName -Recurse -Force } catch {} }
        if (Test-Path "kokoro") {
            $kokoroItems = Get-ChildItem -Path "kokoro" -Force
            foreach ($item in $kokoroItems) { try { Move-Item $item.FullName -Destination . -Force } catch {} }
            Remove-Item "kokoro" -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path ".git") { Remove-Item ".git" -Recurse -Force }
        Write-Host "Kokoro repo ready."
    } finally {
        Pop-Location
    }
}

Test-UV
Install-KokoroRepo

# Model directory mirrors the path computed in main.py:
#   project_root = workers/text-to-speech/kokoro/../../../  =>  app root
#   model_dir    = <app_root>/models/tts/kokoro
$MODEL_DIR = [System.IO.Path]::GetFullPath((Join-Path $SCRIPT_DIR "..\..\..\models\tts\kokoro"))
New-Item -ItemType Directory -Force -Path $MODEL_DIR | Out-Null

# Extract --source and --device values from forwarded arguments
$SOURCE = "huggingface"
$DEVICE = ""
$ScriptArgs = $args
for ($i = 0; $i -lt $ScriptArgs.Count; $i++) {
    if ($ScriptArgs[$i] -eq "--source" -and ($i + 1) -lt $ScriptArgs.Count) {
        $SOURCE = $ScriptArgs[$i + 1]
    } elseif ($ScriptArgs[$i] -match "^--source=(.+)$") {
        $SOURCE = $Matches[1]
    } elseif ($ScriptArgs[$i] -eq "--device" -and ($i + 1) -lt $ScriptArgs.Count) {
        $DEVICE = $ScriptArgs[$i + 1]
    } elseif ($ScriptArgs[$i] -match "^--device=(.+)$") {
        $DEVICE = $Matches[1]
    }
}

function Install-ExportVenv {
    Write-Host "Setting up export virtual environment (.export-venv)..."
    & $UV_CMD venv --seed --clear (Join-Path $SCRIPT_DIR ".export-venv")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $UV_CMD pip install `
        --python (Join-Path $SCRIPT_DIR ".export-venv\Scripts\python.exe") `
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
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Export virtual environment ready."
}

$EXPORT_PYTHON = Join-Path $SCRIPT_DIR ".export-venv\Scripts\python.exe"

if (-not (Test-Path $EXPORT_PYTHON)) {
    Write-Host "Export virtual environment not found. Setting it up..."
    Install-ExportVenv
}

# Export model to OpenVINO IR using the export venv (skipped automatically if already done)
$NPU_FLAGS = @()
if ($DEVICE -eq "NPU") {
    $NPU_FLAGS = @("--npu")
}

Write-Host "Running model export to OpenVINO IR..."
& $EXPORT_PYTHON (Join-Path $SCRIPT_DIR "export.py") --model_dir $MODEL_DIR --source $SOURCE @NPU_FLAGS
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $SCRIPT_DIR
if (-not (Test-Path (Join-Path $SCRIPT_DIR ".venv"))) {
    & $UV_CMD venv --seed
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Build a clean arg list: strip any --device/--device=... the caller passed,
# since we have already resolved the device and will pass it explicitly.
$FILTERED_ARGS = @()
$SkipNext = $false
foreach ($arg in $ScriptArgs) {
    if ($SkipNext) {
        $SkipNext = $false
        continue
    }
    if ($arg -eq "--device") {
        $SkipNext = $true
        continue
    } elseif ($arg -match "^--device=") {
        continue
    }
    $FILTERED_ARGS += $arg
}

$DEVICE_ARGS = @()
if ($DEVICE -ne "") {
    $DEVICE_ARGS = @("--device", $DEVICE)
}

& $UV_CMD run main.py @DEVICE_ARGS @FILTERED_ARGS
exit $LASTEXITCODE
