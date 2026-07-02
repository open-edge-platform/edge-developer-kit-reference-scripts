# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'

# Set UTF-8 encoding for console output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$REPO_ROOT = Resolve-Path (Join-Path $SCRIPT_DIR '..\..')
$NODE_DIR = Join-Path $REPO_ROOT 'thirdparty\node'
$NODE_PATH = Join-Path $NODE_DIR 'node.exe'
$SETUP_THIRDPARTY = Join-Path $SCRIPT_DIR 'setup_thirdparty.ps1'
$EXPORT_SCRIPT = Join-Path $REPO_ROOT 'scripts\export-samples.mjs'

# Install bundled Node.js if not already present
if (-not (Test-Path $NODE_PATH)) {
    Write-Host "Bundled Node.js not found. Running thirdparty setup..."
    if (-not (Test-Path $SETUP_THIRDPARTY)) {
        Write-Host "ERROR: Setup script not found at $SETUP_THIRDPARTY" -ForegroundColor Red
        exit 1
    }
    & $SETUP_THIRDPARTY
}

# Prepend bundled node to PATH for this session
$env:PATH = "$NODE_DIR;$env:PATH"

# Verify node is accessible
try {
    $null = & $NODE_PATH --version
} catch {
    Write-Host "ERROR: Node.js is not accessible at $NODE_PATH" -ForegroundColor Red
    exit 1
}

# If arguments were passed, forward them directly (non-interactive mode).
if ($args.Count -gt 0) {
    & $NODE_PATH $EXPORT_SCRIPT @args
    exit $LASTEXITCODE
}

# ── Interactive mode ──────────────────────────────────────────────
Write-Host ""
Write-Host "Discovering available samples..."
$samples = (& $NODE_PATH $EXPORT_SCRIPT --list) |
    Where-Object { $_ -match '^\s+-\s' } |
    ForEach-Object { ($_ -replace '^\s+-\s', '').Trim() }

if (-not $samples -or $samples.Count -eq 0) {
    Write-Host "ERROR: No samples found." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Available samples:"
for ($i = 0; $i -lt $samples.Count; $i++) {
    Write-Host ("{0,4}) {1}" -f ($i + 1), $samples[$i])
}

Write-Host ""
$selection = Read-Host "Enter sample number(s) to export (space/comma separated)"
$chosen = @()
foreach ($n in ($selection -split '[,\s]+' | Where-Object { $_ })) {
    if ($n -notmatch '^\d+$' -or [int]$n -lt 1 -or [int]$n -gt $samples.Count) {
        Write-Host "ERROR: Invalid selection '$n'." -ForegroundColor Red
        exit 1
    }
    $chosen += $samples[[int]$n - 1]
}
if ($chosen.Count -eq 0) {
    Write-Host "ERROR: No samples selected." -ForegroundColor Red
    exit 1
}

$exportArgs = @("--samples=$($chosen -join ',')") 

$opt = Read-Host "Include optional service dependencies? [Y/n]"
if ($opt -match '^[Nn]') { $exportArgs += '--no-optional' }

$outdir = Read-Host "Output directory (blank for default)"
if ($outdir) { $exportArgs += "--out=$outdir" }

$dry = Read-Host "Dry run (preview plan only)? [y/N]"
if ($dry -match '^[Yy]') { $exportArgs += '--dry-run' }

Write-Host ""
Write-Host "Running: export-samples $($exportArgs -join ' ')"
& $NODE_PATH $EXPORT_SCRIPT @exportArgs
exit $LASTEXITCODE
