#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Build the Vertical Reference Solutions Blueprint for production (Windows).

.DESCRIPTION
  The PowerShell counterpart of scripts/build.sh: the embedded bundle packaged
  as a desktop app. Hands over to electron\build.ps1 --bundle-app, which checks
  the toolchain, asks the install questions, exports the bundle
  (scripts/bundle.mjs) and packages it - all in one process, so the questions
  come before the long work.

.EXAMPLE
  scripts\build.bat
  Ask for the install settings, then build.

.EXAMPLE
  scripts\build.bat -- --yes --targets=nsis
  Non-interactive, one installer .exe.

.EXAMPLE
  setup_win.bat --build -- --yes
  Set up the kiosk's dependencies, then build, in one go.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Show-Usage {
    Write-Host @"
Usage: scripts\build.bat [-- <extra args>]   (or: setup_win.bat --build [-- <extra args>])

Builds the embedded bundle packaged as a desktop app (.exe and/or .msi - the
build asks which, before any long work starts): a minimal studio export with
the kiosk injected as a sample, shipped pre-setup. First launch on the
terminal unpacks it, runs the studio's setup (runtimes, worker envs -
downloads), then starts the studio as the main process - the window opens on
it - and the studio runs the blueprint as its own worker on another URL.
Packages are copied to build\. Works from a totally clean checkout: missing
dependencies are installed on the way. The Edge AI Studio checkout at
EDGE_AI_STUDIO_DIR is only the export source - it does not need to be set up.

Extra args after --:
  --yes, --fullscreen, --windowed, --targets=nsis,msi   go to the shell
  anything else (--mode, --port, --allow-missing, ...)  goes to scripts/bundle.mjs

Options:
  -h, --help      this help

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

Invoke-DesktopBuild $Arguments
