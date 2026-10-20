#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Build the Vertical Reference Solutions Blueprint for production (Windows).

.DESCRIPTION
  The PowerShell counterpart of scripts/build.sh: the embedded bundle packaged
  as a desktop app, one per kiosk setup_win.bat set up (or --kiosk) - or, with
  --mock, the kiosk alone with its AI mocked, no studio anywhere. Hands over to electron\build.ps1 --bundle-app, which checks
  the toolchain, asks the install questions, exports the bundle
  (scripts/bundle.mjs) and packages it - all in one process, so the questions
  come before the long work.

.EXAMPLE
  common\scripts\build.bat
  Ask for the install settings, then build every kiosk setup_win.bat set up.

.EXAMPLE
  common\scripts\build.bat --kiosk healthcare
  Just that one.

.EXAMPLE
  common\scripts\build.bat --mock
  No studio: the kiosk alone, AI mocked, hardware simulated.

.EXAMPLE
  common\scripts\build.bat -- --yes --targets=nsis
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
Usage: common\scripts\build.bat [--kiosk <names>] [--mock] [-- <extra args>]
   or: setup_win.bat --build [--kiosk <names>] [--mock] [-- <extra args>]   (sets the kiosks up first)

Builds the embedded bundle packaged as a desktop app (.exe and/or .msi - the
build asks which, before any long work starts) for every kiosk setup_win.bat
set up: a minimal studio export with the kiosk injected as a sample, shipped
pre-setup. First launch on the
terminal unpacks it, runs the studio's setup (runtimes, worker envs -
downloads), then starts the studio as the main process - the window opens on
it - and the studio runs the blueprint as its own worker on another URL.
Packages are copied to build\ at the repo root, the exported bundles go to
build\kiosk-studio\<kiosk>\. Works from a totally clean checkout: missing
dependencies are installed on the way. The Edge AI Studio checkout at
EDGE_AI_STUDIO_DIR is only the export source - it does not need to be set up.

Options:
  --kiosk <names>   which kiosks: $(Get-KioskIds) or all, comma separated
                    (default: what setup_win.bat saved)
  --mock            no studio: package the kiosk alone, its AI mocked and its
                    hardware simulated when absent, as build\<product>-<version>-mock.exe.
                    Needs no studio checkout. Run it with start_win.bat --desktop --mock
  -h, --help        this help

Extra args after --, for every kiosk's build:
  --yes, --fullscreen, --windowed, --targets=nsis,msi          go to the shell
  anything else (--mode, --llm, --port, --allow-missing, ...)  goes to scripts/bundle.mjs

Studio location: EDGE_AI_STUDIO_DIR (env or .kioskrc), currently:
  $EdgeAiStudioDir
"@
}

$KioskArg = ''
$Mock = $false
$BuildArgs = @()
for ($i = 0; $i -lt $Arguments.Count; $i++) {
    switch -Regex ($Arguments[$i]) {
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        '^-{1,2}kiosk$' {
            $i++
            $KioskArg = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskArg) { Stop-WithError '--kiosk needs a value' }
        }
        '^-{1,2}mock$' { $Mock = $true }
        '^--$' {
            $BuildArgs = @(if ($i + 1 -lt $Arguments.Count) { $Arguments[($i + 1)..($Arguments.Count - 1)] })
            $i = $Arguments.Count
        }
        default {
            Show-Usage
            Stop-WithError "unknown argument: $($Arguments[$i]) (the web/desktop/studio/bundle targets were removed - this is the only build method for now)"
        }
    }
}

Resolve-Kiosks $KioskArg
Assert-Node

# The embedded bundle, or with --mock the kiosk alone.
$Flow = if ($Mock) { @('--mock') } else { @('--bundle-app') }

if ($KioskDirs.Count -eq 1) {
    Confirm-Config
    Confirm-AdminPassword
    Invoke-DesktopBuild (@($Flow) + @($BuildArgs))
    exit 0
}

# Several kiosks: every kiosk's questions first, then the builds one after
# another (they share electron\'s staging directories).
$answers = @()
foreach ($dir in $KioskDirs) {
    Use-Kiosk $dir
    Confirm-Config
    Confirm-AdminPassword
    Write-Info "Build settings for $(Get-KioskLabel $dir)"
    $answers += , (Get-BuildAnswers (@($Flow) + @($BuildArgs)))
}
for ($i = 0; $i -lt $KioskDirs.Count; $i++) {
    Use-Kiosk $KioskDirs[$i]
    Write-Info "Building $(Get-KioskLabel $KioskDir) ($($i + 1) of $($KioskDirs.Count))"
    Invoke-DesktopBuild (@($Flow) + @($answers[$i]))
}
Write-Ok "Installers for $(Get-SelectedKioskIds) are in build\"
