# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

# Vendors hexgrad/kokoro (pinned in workers\oep-services.json, kokoro.patch applied) into .\kokoro;
# cheap when it is already there.
Test-UV
Invoke-OepFetch services/text-to-speech/kokoro
Invoke-OepFetch common/downloader

# Same directory main.py uses: <app_root>\models\tts\kokoro.
$MODEL_DIR = [System.IO.Path]::GetFullPath((Join-Path $ModelsDir "\tts\kokoro"))
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

# The export tools (torch, kokoro, misaki) get their own venv beside workers\.venv: nested this
# deep in a long app directory, spaCy's DLLs exceed the path length Windows loads DLLs from
# ("DLL load failed ... The filename or extension is too long").
$EXPORT_VENV = Join-Path $WorkersRoot ".venv-kokoro-export"
$EXPORT_PYTHON = Join-Path $EXPORT_VENV "Scripts\python.exe"

function Install-ExportVenv {
    Write-Host "Setting up export virtual environment ($EXPORT_VENV)..."
    & $UvCmd venv --seed --clear $EXPORT_VENV
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $UvCmd pip install `
        --python $EXPORT_PYTHON `
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
    # export.py fetches weights through the shared model-downloader package.
    & $UvCmd pip install `
        --python $EXPORT_PYTHON `
        -q `
        -e (Join-Path $WorkersRoot "common\downloader")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Export virtual environment ready."
}

# Export model to OpenVINO IR using the export venv (skipped automatically if already done)
$NPU_FLAGS = @()
if ($DEVICE -eq "NPU") {
    $NPU_FLAGS = @("--npu")
}

# Instances started side by side share the export venv and model directory: one builds them
# while the others wait.
$exportMutex = [System.Threading.Mutex]::new($false, 'Local\EdgeAIStudioKokoroExport')
$acquired = $false
try {
    # An instance stopped mid-export abandons the mutex; the wait still
    # takes it, and the checks below redo whatever is missing.
    try {
        $acquired = $exportMutex.WaitOne([TimeSpan]::FromHours(1))
    } catch [System.Threading.AbandonedMutexException] {
        $acquired = $true
    }
    if (-not $acquired) {
        throw "Timed out waiting for another Kokoro instance to finish the model export"
    }
    if (-not (Test-Path $EXPORT_PYTHON)) {
        Write-Host "Export virtual environment not found. Setting it up..."
        Install-ExportVenv
    } else {
        if (-not (Test-PythonModules $EXPORT_PYTHON torch openvino misaki)) {
            # An earlier setup stopped during the dependency install.
            Write-Host "Export virtual environment is incomplete. Rebuilding it..."
            Install-ExportVenv
        }
        # Continue: under Stop, Windows PowerShell 5.1 throws on the first line of
        # redirected stderr, so a failed import would end the script here.
        & { $ErrorActionPreference = 'Continue'; & $EXPORT_PYTHON -c "import model_downloader" 2>$null | Out-Null }
        if ($LASTEXITCODE -ne 0) {
            # Older export venvs link model-downloader's former path; refresh just that install.
            Write-Host "Installing the shared model-downloader package into the export environment..."
            & $UvCmd pip install --python $EXPORT_PYTHON -q -e (Join-Path $WorkersRoot "common\downloader")
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
    }

    Write-Host "Running model export to OpenVINO IR..."
    & $EXPORT_PYTHON (Join-Path $SCRIPT_DIR "export.py") --model_dir $MODEL_DIR --source $SOURCE @NPU_FLAGS
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    if ($acquired) { $exportMutex.ReleaseMutex() }
    $exportMutex.Dispose()
}

Set-Location $SCRIPT_DIR
# Drop the caller's --device; DEVICE_ARGS passes it explicitly.
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

Sync-Worker
# An older venv may still hold unidic (dictionary never downloaded; `uv sync --inexact` keeps it),
# which fugashi prefers over unidic-lite, so the Japanese voices fail until it goes.
$WorkspaceVenv = Join-Path $WorkersRoot ".venv"
if (Test-Path (Join-Path $WorkspaceVenv "Lib\site-packages\unidic\__init__.py")) {
    & $UvCmd pip uninstall -q --python $WorkspaceVenv unidic
    if ($LASTEXITCODE -ne 0) { Write-Host "Warning: could not remove the stale unidic package; Japanese voices may fail." }
}
& $UvCmd run --no-sync main.py @DEVICE_ARGS @FILTERED_ARGS
exit $LASTEXITCODE
