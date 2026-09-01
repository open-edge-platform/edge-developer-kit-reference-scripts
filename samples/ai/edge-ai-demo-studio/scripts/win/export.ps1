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
$EXPORT_SCRIPT = Join-Path $REPO_ROOT 'scripts\export-bundle.mjs'

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

# --dry-run/--plan alone should still walk through the interactive prompts
# (just previewing the plan instead of writing files), so pull it out before
# deciding whether to forward everything non-interactively.
$dryRunFlag = $null
$remainingArgs = @()
foreach ($a in $args) {
    if ($a -eq '--dry-run' -or $a -eq '--plan') {
        $dryRunFlag = $a
    } else {
        $remainingArgs += $a
    }
}

# If other arguments were passed, forward everything directly (non-interactive mode).
if ($remainingArgs.Count -gt 0) {
    & $NODE_PATH $EXPORT_SCRIPT @args
    exit $LASTEXITCODE
}

# ── Interactive mode ──────────────────────────────────────────────
Write-Host ""
Write-Host "Discovering available samples and services..."
# --list prints two sections ("Available samples:" / "Available services:"),
# each with "  - <id>" entries.
$listOutput = & $NODE_PATH $EXPORT_SCRIPT --list
$samples = @()
$services = @()
$section = ''
foreach ($line in $listOutput) {
    if ($line -match '^Available samples:') { $section = 'samples'; continue }
    if ($line -match '^Available services:') { $section = 'services'; continue }
    if ($line -match '^\s+-\s') {
        $id = ($line -replace '^\s+-\s', '').Trim()
        if ($section -eq 'services') { $services += $id } else { $samples += $id }
    }
}

if ($samples.Count -eq 0 -and $services.Count -eq 0) {
    Write-Host "ERROR: No samples or services found." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Available samples:"
for ($i = 0; $i -lt $samples.Count; $i++) {
    Write-Host ("{0,4}) {1}" -f ($i + 1), $samples[$i])
}
Write-Host ""
Write-Host "Available services:"
for ($i = 0; $i -lt $services.Count; $i++) {
    Write-Host ("{0,4}) {1}" -f ($samples.Count + $i + 1), $services[$i])
}

# Resolve a space/comma-separated selection (numbers continue past the sample
# list into the service list, or literal ids) into sample/service id arrays.
function Resolve-Selection([string]$Prompt) {
    $selection = Read-Host $Prompt
    $pickedSamples = @()
    $pickedServices = @()
    $total = $samples.Count + $services.Count
    foreach ($tok in ($selection -split '[,\s]+' | Where-Object { $_ })) {
        if ($tok -match '^\d+$' -and [int]$tok -ge 1 -and [int]$tok -le $total) {
            if ([int]$tok -le $samples.Count) {
                $pickedSamples += $samples[[int]$tok - 1]
            } else {
                $pickedServices += $services[[int]$tok - 1 - $samples.Count]
            }
            continue
        }
        if ($samples -contains $tok) {
            $pickedSamples += $tok
            continue
        }
        if ($services -contains $tok) {
            $pickedServices += $tok
            continue
        }
        Write-Host "ERROR: Invalid selection '$tok'." -ForegroundColor Red
        exit 1
    }
    return ,@($pickedSamples, $pickedServices)
}

Write-Host ""
$chosen = Resolve-Selection "Enter number(s) or name(s) to export (samples and/or services, space/comma separated, blank for none)"
# Drop duplicates (e.g. the same service picked once by number, once by name).
$chosenSamples = @($chosen[0] | Select-Object -Unique)
$chosenServices = @($chosen[1] | Select-Object -Unique)

if ($chosenSamples.Count -eq 0 -and $chosenServices.Count -eq 0) {
    Write-Host "ERROR: Nothing selected - pick at least one sample or service." -ForegroundColor Red
    exit 1
}

$exportArgs = @()
if ($chosenSamples.Count -gt 0) { $exportArgs += "--samples=$($chosenSamples -join ',')" }
if ($chosenServices.Count -gt 0) { $exportArgs += "--services=$($chosenServices -join ',')" }

# Optional deps only come from selected samples; skip if none were chosen.
if ($chosenSamples.Count -gt 0) {
    $opt = Read-Host "Include optional service dependencies? [Y/n]"
    if ($opt -match '^[Nn]') { $exportArgs += '--no-optional' }
}

$outdir = Read-Host "Output directory (blank for default)"
if ($outdir) { $exportArgs += "--out=$outdir" }

if ($dryRunFlag) { $exportArgs += $dryRunFlag }

Write-Host ""
Write-Host "Running: export-bundle $($exportArgs -join ' ')"
& $NODE_PATH $EXPORT_SCRIPT @exportArgs
exit $LASTEXITCODE
