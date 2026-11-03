# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Start the speech-to-text worker on OpenVINO Model Server (metadata.sttBackend "ovms"; ..\oep is
# the other backend).

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$ScriptDir = $SCRIPT_DIR
$WorkersRoot = $SCRIPT_DIR
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

# Resolve-PhysicalPath <path> -- <path> with every junction and symlink followed, as Python's
# Path.resolve() reports it ([IO.Path]::GetFullPath follows none).
function Resolve-PhysicalPath {
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $parent = [System.IO.Path]::GetDirectoryName($full)
    if ($parent) {
        $full = [System.IO.Path]::Combine((Resolve-PhysicalPath $parent), [System.IO.Path]::GetFileName($full))
    }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -in 'Junction', 'SymbolicLink') {
        # A relative target is relative to the link's directory.
        $target = @($item.Target)[0]
        return Resolve-PhysicalPath ([System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($full), $target))
    }
    return $full
}

# Qwen3-ASR (an optimum-intel fork on transformers 5.13) converts in its own pinned environment,
# which model_downloader.ovms picks; fetch and sync it the first time such a model is selected.
# Mirrors prepare_export_env in start.sh.
function Initialize-ExportEnv {
    param([string[]]$WorkerArgs)
    $Model = ""
    for ($i = 0; $i -lt $WorkerArgs.Length; $i++) {
        $Arg = [string]$WorkerArgs[$i]
        if (($Arg -eq "--model" -or $Arg -eq "--stt-model-id") -and $i + 1 -lt $WorkerArgs.Length) {
            $Model = [string]$WorkerArgs[$i + 1]
        } elseif ($Arg -like "--model=*" -or $Arg -like "--stt-model-id=*") {
            $Model = $Arg.Substring($Arg.IndexOf("=") + 1)
        }
    }
    if (-not $Model) { return }

    Push-Location $ScriptDir
    try {
        $Line = (& $UvCmd run --no-sync python -m model_downloader ovms-export-env $Model | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
    if (-not $Line) { return }
    $Parts = $Line -split " ", 3
    $Project = $Parts[0]
    $State = $Parts[1]
    $Venv = $Parts[2]

    $ProjectDir = Join-Path $WorkersRoot $Project
    # model_downloader reports a resolved path, and .venv may be a junction
    # (the CI cache links each one in); compare against the physical one.
    if ([System.IO.Path]::GetFullPath($Venv) -ne (Resolve-PhysicalPath (Join-Path $ProjectDir ".venv"))) {
        # An override variable names another environment; use it as is.
        Write-Host "$Model converts with $Venv (not synced here)."
        return
    }
    Write-Host "$Model converts with $Project; checking that environment..."
    Invoke-OepFetch $Project
    & $UvCmd sync --project $ProjectDir
    if ($LASTEXITCODE -ne 0) {
        if ($State -eq "ready") {
            Write-Host "WARNING: could not sync $Project; using the environment as it is." -ForegroundColor Yellow
        } else {
            Write-Host "ERROR: could not provision $Project, which $Model is converted with." -ForegroundColor Red
            exit 1
        }
    }
}

Test-FFmpeg
# Install OVMS and its template dependencies when this backend starts.
Initialize-Ovms
Sync-Worker
Initialize-ExportEnv -WorkerArgs $args
Start-Worker @args
exit $LASTEXITCODE
