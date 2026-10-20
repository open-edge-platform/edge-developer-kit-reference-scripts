#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Run the Vertical Reference Solutions Blueprint in development mode (hot reload).

.DESCRIPTION
  The PowerShell counterpart of scripts/dev/dev.sh — same flags. Run it through
  scripts\dev\dev.bat.

.EXAMPLE
  scripts\dev\dev.bat --mock
  Mocked AI, zero external dependencies.

.EXAMPLE
  scripts\dev\dev.bat --kiosk healthcare
  That kiosk instead of public-service.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Mock = $false; $NoStudio = $false; $Desktop = $false; $KioskArg = ''
$ExtraArgs = @()

function Show-Usage {
    Write-Host @"
Usage: common\scripts\dev\dev.bat [--kiosk <name>] [options] [-- <extra args>]

Development mode: ensures the Edge AI Studio gateway is running, then starts
the Next.js dev server (hot reload) on the kiosk's port (kiosk.json "port":
public-service http://localhost:3000, healthcare http://localhost:3001; PORT
overrides it). One kiosk at a time. setup_win.bat --dev sets the kiosks up
first, then runs this.

Options:
  --kiosk <name> which kiosk: $(Get-KioskIds) (default: `$env:KIOSK_DIR, else
                 $(Get-KioskId (Join-Path $WorkspaceRoot $DefaultKiosk)))
  --mock         mock the AI services (KIOSK_LLM_MOCK=true, verification off);
                 the studio is not started - best for pure UI work
  --no-studio    don't start/check the studio, keep live AI settings
  --desktop      run the desktop (Electron) shell in dev mode instead of the
                 browser dev server; extra args after -- go to the shell's build
                 script (e.g. common\scripts\dev\dev.bat --desktop -- --yes --mode=touch)
  -h, --help     this help

Config precedence and all settings: docs/configuration.md.
Prefer frontend/config.local.yaml for persistent personal overrides.
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $arg = $Arguments[$i]
    if ($arg -eq '--') { $ExtraArgs = @($Arguments[($i + 1)..($Arguments.Count - 1)]); break }
    switch -Regex ($arg) {
        '^-{1,2}kiosk$' {
            $i++
            $KioskArg = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskArg) { Stop-WithError '--kiosk needs a value' }
        }
        '^-{1,2}mock$' { $Mock = $true }
        '^-{1,2}no-studio$' { $NoStudio = $true }
        '^-{1,2}desktop$' { $Desktop = $true }
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        default { Show-Usage; Stop-WithError "unknown option: $arg" }
    }
}

if ($KioskArg) {
    Resolve-Kiosks $KioskArg
    if ($KioskDirs.Count -gt 1) {
        Stop-WithError "dev mode runs one kiosk at a time - pick one: --kiosk <$((Get-KioskIds) -replace ', ', '|')>"
    }
}

Assert-Node
Confirm-FrontendDeps
Confirm-Config
Confirm-AdminPassword

if ($Mock) {
    Set-MockEnv
} elseif ($NoStudio -or $StudioAutostart -eq '0') {
    Write-Info "Not managing the studio; expecting live services at $StudioUrl"
    if (Test-StudioUp) { Test-StudioServices }
    else { Write-Warn "studio gateway not reachable at $StudioUrl - expect the out-of-service screen (or use --mock)" }
} else {
    Confirm-Studio
}

if ($Desktop) {
    Write-Info 'Starting the desktop shell in dev mode (electron/)'
    Invoke-Npm -NpmArgs (@('run', 'dev', '--') + $ExtraArgs) -WorkingDirectory $ElectronDir
    exit 0
}

if (-not $env:PORT) { $env:PORT = "$(Get-KioskPort $KioskDir)" }
$port = $env:PORT
Write-Info "Starting the Next.js dev server for $(Get-KioskLabel $KioskDir) at http://localhost:$port"
Write-Host "    kiosk UI      http://localhost:$port"
Write-Host "    chat/voice    http://localhost:$port/chat"
Write-Host "    enroll desk   http://localhost:$port/enroll"
Write-Host "    admin (CMS)   http://localhost:$port/admin  ($(Get-AdminLogin))"
Write-Host "    health        http://localhost:$port/api/health"
Write-Host ''
Invoke-Npm -NpmArgs (@('run', 'dev') + $ExtraArgs) -WorkingDirectory $FrontendDir
