#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Start the Vertical Reference Blueprint - production server plus its Edge AI Studio prerequisite.

.DESCRIPTION
  The PowerShell counterpart of start.sh — same flags. Run it through start_win.bat.

.EXAMPLE
  start_win.bat
  Start the studio (if needed) + the kiosk on :3000.

.EXAMPLE
  start_win.bat --mock
  Start with mocked AI, no studio required.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Mock = $false; $NoStudio = $false; $Rebuild = $false; $Tauri = $false
$Bundle = $false; $PortArg = ''

function Show-Usage {
    Write-Host @"
Usage: start_win.bat [options]

Starts the blueprint for normal use:
  1. ensures the Edge AI Studio gateway is running (starts it if not)
  2. builds the frontend if no production build exists
  3. serves the kiosk at http://localhost:3000

Options:
  --mock         run with mocked AI services (skips the studio entirely)
  --no-studio    don't start/check the studio, keep live AI settings
                 (use when the gateway runs on another machine - set STUDIO_URL)
  --tauri        launch the desktop shell instead of the web server
                 (still auto-starts the studio first; build it with build_win.bat)
  --bundle       start the embedded bundle - Linux only, see docs/embedded-studio.md
  --rebuild      force a fresh production build
  --port <n>     serve on a different port (default 3000; with --tauri this
                 pins KIOSK_PORT for the app's internal server)
  -h, --help     this help

The studio is left running when you stop the kiosk (Ctrl+C); stop it separately
if you need to. Studio location/behaviour: EDGE_AI_STUDIO_DIR, STUDIO_URL,
STUDIO_RUN_MODE, STUDIO_AUTOSTART - via env or .kioskrc (docs/configuration.md).
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    switch -Regex ($Arguments[$i]) {
        '^-{1,2}mock$' { $Mock = $true }
        '^-{1,2}no-studio$' { $NoStudio = $true }
        '^-{1,2}tauri$' { $Tauri = $true }
        '^-{1,2}bundle$' { $Bundle = $true }
        '^-{1,2}rebuild$' { $Rebuild = $true }
        '^-{1,2}port$' {
            $i++
            $PortArg = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $PortArg) { Stop-WithError '--port needs a value' }
        }
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        default { Show-Usage; Stop-WithError "unknown option: $($Arguments[$i])" }
    }
}

Assert-Node

if ($Bundle) {
    Stop-WithError @"
--bundle is Linux only: the embedded bundle is produced by scripts/bundle.sh
and started by the platform's own bash start.sh. See docs/embedded-studio.md.
"@
}

Confirm-FrontendDeps
Confirm-Config
Confirm-AdminPassword

$KioskPort = if ($PortArg) { $PortArg } elseif ($env:PORT) { $env:PORT } else { '3000' }
$env:PORT = $KioskPort # next start listens here; the CMS proxy URL derives from it too

# 1. Prerequisite: Edge AI Studio ------------------------------------------
if ($Mock) {
    Set-MockEnv
} elseif ($NoStudio -or $StudioAutostart -eq '0') {
    Write-Info "Not managing the studio (--no-studio); expecting live services at $StudioUrl"
    if (Test-StudioUp) { Test-StudioServices }
    else { Write-Warn "studio gateway not reachable at $StudioUrl - the kiosk may show its out-of-service screen" }
} else {
    Confirm-Studio
}

# 2. Desktop app mode -------------------------------------------------------
# The packaged app carries its own frontend build, Node runtime and pre-seeded
# database, and spawns its own web-server process on a loopback port - so with
# --tauri the studio is up (step 1) and we just launch the app.
if ($Tauri) {
    $app = Join-Path $TauriDir 'src-tauri\target\release\kiosk-desktop.exe'
    if (-not (Test-Path -LiteralPath $app)) {
        Stop-WithError "no desktop build found at $app - package one first: build_win.bat"
    }
    if ($PortArg) { $env:KIOSK_PORT = $PortArg }
    Write-Info "Launching the desktop kiosk: $app"
    & $app
    exit $LASTEXITCODE
}

# 3. Database priming (first run only) -------------------------------------
# Payload only creates + seeds the SQLite schema outside production, so a fresh
# checkout needs one dev boot before `next start` can serve.
$db = Join-Path $FrontendDir 'db.sqlite'
if (-not ((Test-Path -LiteralPath $db) -and (Get-Item -LiteralPath $db).Length -gt 0)) {
    Write-Info 'No database yet - priming db.sqlite with a one-off dev boot (first run only)'
    $primeLog = Join-Path $RepoRoot '.prime.log'
    Remove-Item -LiteralPath $primeLog -Force -ErrorAction SilentlyContinue
    $npm = (Get-Command npm).Source
    $prime = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$npm`" run dev > `"$primeLog`" 2>&1" `
        -WorkingDirectory $FrontendDir -WindowStyle Hidden -PassThru
    $waited = 0
    try {
        while (-not ((Test-Path -LiteralPath $db) -and (Get-Item -LiteralPath $db).Length -gt 0)) {
            Test-Url "http://localhost:$KioskPort/admin" 5 | Out-Null
            Start-Sleep -Seconds 3
            $waited += 3
            if ($waited -ge 240) { Stop-WithError "database was not created within 240s - check $primeLog" }
        }
        Start-Sleep -Seconds 3 # let seeding finish writing
    } finally {
        # next dev runs as a grandchild of cmd.exe, so kill the whole tree.
        & taskkill /T /F /PID $prime.Id 2>&1 | Out-Null
    }
    Write-Ok 'Database created and seeded'
}

# 4. Production build -------------------------------------------------------
if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $FrontendDir '.next\BUILD_ID'))) {
    Write-Info 'Building the frontend (production)'
    Invoke-Npm -NpmArgs @('run', 'build') -WorkingDirectory $FrontendDir
} else {
    Write-Info 'Reusing existing production build (use --rebuild to force a fresh one)'
}

# 5. Serve ------------------------------------------------------------------
Write-Info "Starting the kiosk at http://localhost:$KioskPort"
Write-Host "    kiosk UI      http://localhost:$KioskPort"
Write-Host "    admin (CMS)   http://localhost:$KioskPort/admin  ($(Get-AdminLogin))"
Write-Host "    health        http://localhost:$KioskPort/api/health"
Write-Host ''
Invoke-Npm -NpmArgs @('run', 'start') -WorkingDirectory $FrontendDir
