#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Build the Vertical Reference Blueprint for production (Windows).

.DESCRIPTION
  Hands over to tauri\build.ps1, which checks the toolchain, asks the install
  questions and packages the app - all in one process.

  Windows packages the kiosk as a standalone desktop app (.exe / .msi): the
  Next.js server compiled to a self-contained folder, a Node runtime and the
  read-only assets, wrapped in the Tauri shell. build.sh's embedded-bundle app
  is not built here - scripts/bundle.sh drives the studio's exporter through
  bash, git and python3, and build.mjs's --bundle-app shells out to it. Build
  that on Linux or WSL. See docs/embedded-studio.md.

.EXAMPLE
  build_win.bat
  Ask for the install settings, then build.

.EXAMPLE
  build_win.bat -- --yes --targets=nsis
  Non-interactive, one installer .exe.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Show-Usage {
    Write-Host @"
Usage: build_win.bat [-- <extra args>]

Builds the kiosk as a desktop app installer (.exe and/or .msi - the build asks
which). It also asks for the settings that cannot be changed after the fact
(terminal mode, fullscreen), because next build inlines them. Packages are
written to tauri\src-tauri\target\release\bundle\.

Extra args after -- go to tauri\build.ps1 -> scripts\build.mjs:
  --yes, --fullscreen, --windowed, --targets=nsis,msi, --mode=touch, --no-build

Options:
  -h, --help      this help

The embedded bundle (build.sh's method) is Linux/WSL only - see
docs/embedded-studio.md.

Studio location: EDGE_AI_STUDIO_DIR (env or .kioskrc), currently:
  $EdgeAiStudioDir
"@
}

if ($Arguments.Count -gt 0) {
    switch -Regex ($Arguments[0]) {
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        '^--$' { $Arguments = @(if ($Arguments.Count -gt 1) { $Arguments[1..($Arguments.Count - 1)] }) }
        default {
            Show-Usage
            Stop-WithError "unknown argument: $($Arguments[0]) (the web/desktop/studio/bundle targets were removed - this is the only build method for now)"
        }
    }
}

Assert-Node
Confirm-Config
Confirm-AdminPassword

$builder = Join-Path $TauriDir 'build.ps1'
if (-not (Test-Path -LiteralPath $builder)) { Stop-WithError "$builder not found" }

# tauri\build.ps1 checks the toolchain, asks the install questions and packages
# the app, so the questions come before the long work. It runs in a child
# PowerShell rather than `& $builder @Arguments`: splatting into a script binds
# `--targets=nsis` as a parameter name, while -File takes it literally.
$psExe = (Get-Process -Id $PID).Path
& $psExe -NoProfile -ExecutionPolicy Bypass -File $builder @Arguments
if ($LASTEXITCODE -ne 0) { Stop-WithError "the desktop build failed (exit $LASTEXITCODE)" }

Write-Ok "Installer(s) under $TauriDir\src-tauri\target\release\bundle\"
