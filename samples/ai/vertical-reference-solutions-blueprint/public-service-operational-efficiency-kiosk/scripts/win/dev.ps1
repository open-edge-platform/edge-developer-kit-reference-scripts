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
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Mock = $false; $NoStudio = $false; $Desktop = $false
$ExtraArgs = @()

function Show-Usage {
    Write-Host @"
Usage: scripts\dev\dev.bat [options] [-- <extra args>]

Development mode: ensures the Edge AI Studio gateway is running, then starts
the Next.js dev server (hot reload) at http://localhost:3000.

Options:
  --mock         mock the AI services (KIOSK_LLM_MOCK=true, verification off);
                 the studio is not started - best for pure UI work
  --no-studio    don't start/check the studio, keep live AI settings
  --desktop      run the desktop (Electron) shell in dev mode instead of the
                 browser dev server; extra args after -- go to the shell's build
                 script (e.g. scripts\dev\dev.bat --desktop -- --yes --mode=touch)
  -h, --help     this help

Config precedence and all settings: docs/configuration.md.
Prefer frontend/config.local.yaml for persistent personal overrides.
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $arg = $Arguments[$i]
    if ($arg -eq '--') { $ExtraArgs = @($Arguments[($i + 1)..($Arguments.Count - 1)]); break }
    switch -Regex ($arg) {
        '^-{1,2}mock$' { $Mock = $true }
        '^-{1,2}no-studio$' { $NoStudio = $true }
        '^-{1,2}desktop$' { $Desktop = $true }
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        default { Show-Usage; Stop-WithError "unknown option: $arg" }
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

Write-Info 'Starting the Next.js dev server at http://localhost:3000'
Write-Host '    kiosk UI      http://localhost:3000'
Write-Host '    chat/voice    http://localhost:3000/chat'
Write-Host '    enroll desk   http://localhost:3000/enroll'
Write-Host "    admin (CMS)   http://localhost:3000/admin  ($(Get-AdminLogin))"
Write-Host '    health        http://localhost:3000/api/health'
Write-Host ''
Invoke-Npm -NpmArgs (@('run', 'dev') + $ExtraArgs) -WorkingDirectory $FrontendDir
