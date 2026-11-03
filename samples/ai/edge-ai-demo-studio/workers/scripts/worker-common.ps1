# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Shared helpers for worker start scripts (PowerShell mirror of worker-common.sh). Dot-source it
# with this bootstrap, which works at any nesting depth:
#
#   $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
#   $WorkersRoot = $ScriptDir
#   while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
#       $WorkersRoot = Split-Path -Parent $WorkersRoot
#   }
#   . (Join-Path $WorkersRoot "scripts\worker-common.ps1")

if (-not $WorkersRoot) {
    $WorkersRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if (-not $ScriptDir) {
    $ScriptDir = $SCRIPT_DIR
}

$ThirdpartyDir     = Join-Path $WorkersRoot "thirdparty"
$UvCmd             = Join-Path $ThirdpartyDir "uv\uv.exe"
$OvmsDir           = Join-Path $ThirdpartyDir "ovms"
$OvmsPath          = Join-Path $OvmsDir "ovms.exe"
# On Windows OVMS ships its own Python, which Initialize-Ovms installs optimum-cli into
# (Linux keeps a separate uv project, common\ovms-export).
$OvmsPythonDir     = Join-Path $OvmsDir "python"
$OptimumCli        = Join-Path $OvmsPythonDir "Scripts\optimum-cli.exe"
# FFmpeg and git come from the project-root setup, one level above workers\.
$ProjectRoot       = Split-Path -Parent $WorkersRoot
$RootThirdpartyDir = Join-Path $ProjectRoot "thirdparty"
$FfmpegDir         = Join-Path $RootThirdpartyDir "ffmpeg"
$FfmpegPath        = Join-Path $FfmpegDir "bin\ffmpeg.exe"
$GitPath           = Join-Path $RootThirdpartyDir "git\cmd\git.exe"
$ModelsDir         = Join-Path $ProjectRoot "models"

# One Hugging Face cache for every worker and what it runs, inside models\ so "Clear model cache"
# reaches it; an HF_HOME already set (deployment, CI) wins. Mirrors worker_common.hf_home().
if (-not $env:HF_HOME) {
    # Keep reading the token `hf auth login` saved under the default HF_HOME.
    if (-not $env:HF_TOKEN_PATH) {
        $HfUserCache = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME ".cache" }
        $env:HF_TOKEN_PATH = Join-Path $HfUserCache "huggingface\token"
    }
    $env:HF_HOME = Join-Path $ModelsDir "huggingface"
}

# Put the project's MinGit first on PATH: oep-setup.ps1 and workers' source fetches look for git
# there, and a machine may have none of its own.
if (Test-Path $GitPath) {
    $env:Path = "$(Split-Path -Parent $GitPath);$env:Path"
}

# Send-StartupEvent <json> -- a report for the app's startup panel (worker_common\startup.py),
# written only when EDGE_AI_STUDIO_STARTUP_EVENTS is set. Callers pass fixed JSON text.
function Send-StartupEvent {
    param([string]$Json)
    if (-not $env:EDGE_AI_STUDIO_STARTUP_EVENTS -or $env:EDGE_AI_STUDIO_STARTUP_EVENTS -eq '0') { return }
    [Console]::Out.WriteLine("")
    [Console]::Out.WriteLine("EDGE_AI_STUDIO_STARTUP $Json")
    [Console]::Out.Flush()
}

function Assert-Tool {
    param([string]$Target, [string]$Label)
    if (Test-Path $Target) { return }
    Write-Host "ERROR: $Label not found at $Target" -ForegroundColor Red
    Write-Host "Please run the workers setup script first (workers\setup.ps1)." -ForegroundColor Red
    exit 1
}

function Test-UV     { Assert-Tool $UvCmd "uv" }
function Test-OVMS   { Assert-Tool $OvmsPath "OVMS" }
function Test-FFmpeg { Assert-Tool $FfmpegPath "FFmpeg" }

# Test-PythonModules <python> <module>... -- whether that interpreter finds every module. A partial
# install leaves the interpreter and entry points without the packages, so check packages, not files.
# find_spec doesn't import (torch takes seconds); -I keeps PYTHONPATH and cwd out.
function Test-PythonModules {
    param(
        [string]$Python,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Modules
    )
    # Under Stop, Windows PowerShell 5.1 throws on redirected stderr.
    $ErrorActionPreference = 'Continue'
    if (-not (Test-Path $Python)) { return $false }
    & $Python -I -c "import importlib.util, sys; sys.exit(any(importlib.util.find_spec(m) is None for m in sys.argv[1:]))" @Modules 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-GitCommand {
    if (Test-Path $GitPath) { return $GitPath }
    $g = Get-Command git -ErrorAction SilentlyContinue
    if ($g) { return "git" }
    Write-Host "ERROR: git not found. Please run the project setup script first." -ForegroundColor Red
    exit 1
}

# Invoke-OepFetch <worker> -- fetch what oep-services.json pins for <worker> (e.g. services/speech-to-text/oep),
# with its patch and overlay\ applied. Cheap and idempotent, so call it on every start. See oep-setup.ps1.
function Invoke-OepFetch {
    param([string]$Worker)
    $global:LASTEXITCODE = 0
    & (Join-Path $WorkersRoot "oep-setup.ps1") -Mode fetch -Target $Worker
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Install the selected worker without removing packages used by other workers.
# The committed lock also lets unrelated vendored sources wait for first start.
function Sync-Worker {
    Test-UV
    $projectFile = Join-Path $ScriptDir "pyproject.toml"
    if (-not (Test-Path $projectFile)) { throw "Missing $projectFile" }
    $nameLine = Get-Content $projectFile | Where-Object { $_ -match '^name\s*=\s*"[^"]+"' } | Select-Object -First 1
    if (-not $nameLine -or $nameLine -notmatch '^name\s*=\s*"([^"]+)"') { throw "No project name in $projectFile" }
    $package = $Matches[1]

    # A first start installs everything (minutes for a torch worker); later ones only check.
    Send-StartupEvent '{"event":"stage","stage":"preparing","detail":"Installing dependencies"}'

    # The shared OEP model-download source is fetched only for workers that need model-downloader.
    # oep-setup.ps1 fails by throwing or by its exit code; both are reported.
    if (Select-String -Path $projectFile -Pattern '"model-downloader' -Quiet) {
        $fetchFailure = '{"event":"failure","summary":"Could not fetch the model downloader sources"}'
        # A fetch that finds the copy current runs no native command and
        # leaves $LASTEXITCODE as it was ($null in a fresh session).
        $global:LASTEXITCODE = 0
        try {
            & (Join-Path $WorkersRoot "oep-setup.ps1") -Mode fetch -Target 'common/downloader'
        } catch {
            Send-StartupEvent $fetchFailure
            throw
        }
        if ($LASTEXITCODE -ne 0) {
            Send-StartupEvent $fetchFailure
            exit $LASTEXITCODE
        }
    }

    Write-Host "Preparing $package..."
    # A worker excluded from the workspace keeps its own uv.lock and venv; members share workers\uv.lock.
    if (Test-Path (Join-Path $ScriptDir "uv.lock")) {
        & $UvCmd sync --frozen --project $ScriptDir
    } else {
        & $UvCmd sync --frozen --inexact --project $WorkersRoot --package $package
    }
    if ($LASTEXITCODE -ne 0) {
        Send-StartupEvent '{"event":"failure","summary":"Could not install the worker dependencies (uv sync failed)"}'
        throw "Failed to sync $package (exit $LASTEXITCODE)"
    }
    Send-StartupEvent '{"event":"stage-end","stage":"preparing"}'
}

# Initialize-Ovms -- install OVMS's template dependencies and model conversion packages into its
# bundled Python, when an OVMS-backed worker starts.
function Initialize-Ovms {
    Test-UV
    Test-OVMS
    Send-StartupEvent '{"event":"stage","stage":"preparing","detail":"Installing the model conversion tools"}'
    $installFailure = '{"event":"failure","summary":"Could not install the model conversion tools (pip install failed)"}'
    $pythonMutex = [System.Threading.Mutex]::new($false, 'Local\EdgeAIStudioOvmsPython')
    $acquired = $false
    try {
        # A worker stopped mid-install abandons the mutex; the wait still
        # takes it, and the checks below redo whatever is missing.
        try {
            $acquired = $pythonMutex.WaitOne([TimeSpan]::FromHours(1))
        } catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            Send-StartupEvent '{"event":"failure","summary":"Timed out waiting for another worker to install the model conversion tools"}'
            throw "Timed out waiting for OVMS Python setup"
        }
        if (-not (Test-Path (Join-Path $OvmsPythonDir "jinja2")) -or -not (Test-Path (Join-Path $OvmsPythonDir "markupsafe"))) {
            Write-Host "Installing Jinja2 and MarkupSafe into OVMS python directory..."
            & $UvCmd pip install --target $OvmsPythonDir "Jinja2==3.1.6" "MarkupSafe==3.0.2"
            if ($LASTEXITCODE -ne 0) {
                Send-StartupEvent $installFailure
                throw "OVMS template dependencies installation failed (exit $LASTEXITCODE)"
            }
        }
        $ovmsPython = Join-Path $OvmsPythonDir "python.exe"
        $requirementsUrl = 'https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/v2026.4.0/demos/common/export_models/requirements.txt'
        # The file installs optimum-intel from a git commit, whose build needs git. That commit is
        # v2.2.0 in all but its version string, so the release wheel stands in for it.
        # Recheck whenever $requirementsUrl moves to another tag.
        $requirementsOverride = 'optimum-intel==2.2.0'
        # Kept next to the packages: a changed recipe installs them again.
        $installRecipe = "$requirementsUrl --overrides $requirementsOverride --prerelease if-necessary-or-explicit"
        $recipeFile = Join-Path $OvmsPythonDir ".export-requirements"
        $installedRecipe = if (Test-Path $recipeFile) { (Get-Content $recipeFile -Raw).Trim() } else { $null }
        if (-not (Test-Path $OptimumCli) -or $installedRecipe -ne $installRecipe -or -not (Test-PythonModules $ovmsPython optimum openvino transformers datasets)) {
            Write-Host "Installing OVMS model conversion packages into its bundled Python..."
            $overridesFile = Join-Path $OvmsPythonDir ".export-overrides.txt"
            Set-Content -Path $overridesFile -Value $requirementsOverride -Encoding ascii
            # uv can't create build venvs from this embeddable (._pth) Python; the extra indexes need pip-style merging.
            # Pre-releases only where pinned (openvino): `allow` took a tokenizers RC transformers can't load
            # CLIP tokenizers with, and reinstalling tokenizers replaces an RC already installed.
            & $UvCmd pip install --python $ovmsPython --system --no-build-isolation --index-strategy unsafe-best-match -r $requirementsUrl --overrides $overridesFile --prerelease if-necessary-or-explicit --upgrade --reinstall-package tokenizers
            if ($LASTEXITCODE -ne 0) {
                Send-StartupEvent $installFailure
                throw "OVMS Python requirements installation failed (exit $LASTEXITCODE)"
            }
            & $UvCmd pip install --python $ovmsPython --system datasets 'pyarrow<21.0.0'
            if ($LASTEXITCODE -ne 0) {
                Send-StartupEvent $installFailure
                throw "OVMS Python datasets installation failed (exit $LASTEXITCODE)"
            }
            Set-Content -Path $recipeFile -Value $installRecipe -Encoding ascii
        }
    } finally {
        if ($acquired) { $pythonMutex.ReleaseMutex() }
        $pythonMutex.Dispose()
    }
    Send-StartupEvent '{"event":"stage-end","stage":"preparing"}'
}

# Start-Worker -- cd into the worker directory and exec its entrypoint under uv. No --project:
# uv finds the workspace (or an excluded worker's own project) by walking up.
function Start-Worker {
    param([Parameter(ValueFromRemainingArguments = $true)]$WorkerArgs)
    Sync-Worker
    Set-Location $ScriptDir
    & $UvCmd run --no-sync main.py @WorkerArgs
}

# Start-OepWorker -- for a worker wrapping an OEP microservice (an "install" entry in
# oep-services.json): build .venv from upstream's own dependency file at the fetched tag
# (scripts\oep_env.py; only checks when nothing changed), then run main.py in it.
function Start-OepWorker {
    param([Parameter(ValueFromRemainingArguments = $true)]$WorkerArgs)
    Test-UV
    Send-StartupEvent '{"event":"stage","stage":"preparing","detail":"Installing dependencies"}'
    $worker = $ScriptDir.Substring($WorkersRoot.TrimEnd('\').Length + 1).Replace('\', '/')
    & $UvCmd run --no-config --no-project --python 3.12 (Join-Path $WorkersRoot "scripts\oep_env.py") --uv $UvCmd $worker
    if ($LASTEXITCODE -ne 0) {
        Send-StartupEvent '{"event":"failure","summary":"Could not install the worker dependencies (uv pip install failed)"}'
        throw "Failed to install the $worker environment (exit $LASTEXITCODE)"
    }
    Send-StartupEvent '{"event":"stage-end","stage":"preparing"}'
    Set-Location $ScriptDir
    # As `uv run` would: upstream starts optimum-cli and the like from this environment by name.
    $env:VIRTUAL_ENV = Join-Path $ScriptDir ".venv"
    $env:PATH = "$(Join-Path $env:VIRTUAL_ENV 'Scripts');$env:PATH"
    & (Join-Path $env:VIRTUAL_ENV "Scripts\python.exe") main.py @WorkerArgs
}
