#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Start the Vertical Reference Solutions Blueprint - the production kiosk servers.

.DESCRIPTION
  The PowerShell counterpart of start.sh — same flags. Run it through start_win.bat.

.EXAMPLE
  start_win.bat
  Start the Edge AI Studio (if needed) and the kiosks setup_win.bat set up, each on its own port.

.EXAMPLE
  start_win.bat --kiosk healthcare
  Just that one, this time.

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

$Mock = $false; $Studio = $true; $WaitStudio = $false; $Rebuild = $false; $Desktop = $false
$Bundle = $false; $PortArg = ''; $KioskArg = ''

function Show-Usage {
    Write-Host @"
Usage: start_win.bat [options]

Starts the blueprint for normal use - every kiosk setup_win.bat set up, or the
ones --kiosk names:
  1. builds each kiosk's frontend if no production build exists
  2. serves each kiosk on its own port (kiosk.json "port": public-service
     http://localhost:3000, healthcare http://localhost:3001)

The Edge AI Studio is started from EDGE_AI_STUDIO_DIR when its gateway isn't
already live at STUDIO_URL, and waited for before the kiosks serve - a missing
studio checkout is an error. One studio serves every kiosk. --no-studio serves
the kiosks against whatever is live and reports the rest on their health page.

Options:
  --kiosk <names>  which kiosks this time: $(Get-KioskIds) or all, comma
                 separated (default: what setup_win.bat saved).
                 <kiosk>\scripts\start_win.bat starts that kiosk alone
  --no-studio    don't start or wait for the studio: serve against whatever is
                 live at STUDIO_URL
  --studio       accepted for compatibility - starting the studio (if it isn't
                 already running) and waiting for its gateway is now the default
  --wait-studio  don't start the studio, but wait for its gateway to answer at
                 STUDIO_URL (someone else launches it - another machine, a
                 service, the studio app)
  --mock         run with mocked AI services (skips the studio entirely)
  --desktop      launch the desktop shell instead of the web server
                 (usually combined with --bundle - build the app with
                 setup_win.bat --build; with --mock, the mocked app from
                 setup_win.bat --build --mock).
                 One kiosk only
  --bundle       start the embedded bundle (build\kiosk-studio\<kiosk>): the
                 minimal studio boots and starts the kiosk as its own hidden child
                 process. Combine with --desktop for a desktop window on the
                 studio (its kiosk sample runs the kit on its own URL).
                 Build it first: setup_win.bat --bundle. One kiosk only
  --rebuild      force a fresh production build
  --port <n>     serve on a different port (with several kiosks: the first on
                 <n>, the next on <n+1>, ...; with --desktop this pins
                 KIOSK_PORT for the app's internal server)
  -h, --help     this help

The studio is left running when you stop the kiosks (Ctrl+C); stop it separately
if you need to. Studio location/behaviour: EDGE_AI_STUDIO_DIR, STUDIO_URL,
STUDIO_RUN_MODE, STUDIO_AUTOSTART - via env or .kioskrc (docs/configuration.md).
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    switch -Regex ($Arguments[$i]) {
        '^-{1,2}kiosk$' {
            $i++
            $KioskArg = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskArg) { Stop-WithError '--kiosk needs a value' }
        }
        '^-{1,2}mock$' { $Mock = $true }
        '^-{1,2}studio$' { $Studio = $true }
        '^-{1,2}wait-studio$' { $WaitStudio = $true }
        '^-{1,2}no-studio$' { $Studio = $false; $WaitStudio = $false }
        '^-{1,2}desktop$' { $Desktop = $true }
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

Resolve-Kiosks $KioskArg
# The desktop app is the unpacked build under electron\out\, which holds the
# kiosk built last - so unlike Linux, --desktop --mock opens one kiosk here too.
if ($KioskDirs.Count -gt 1 -and ($Bundle -or $Desktop)) {
    Stop-WithError "--bundle and --desktop start one kiosk - pick it with --kiosk <$((Get-KioskIds) -replace ', ', '|')>"
}
Assert-Node

# Embedded-bundle mode: the bundle's own studio is the process manager - it
# boots on :8080 and starts the kiosk as a hidden worker process, so none of
# the normal studio/build/serve steps below apply.
if ($Bundle) {
    $bundleDir = Get-KioskBundleDir
    $bundleEnv = Join-Path $bundleDir 'bundle.env'
    if (-not (Test-Path -LiteralPath $bundleEnv)) {
        Stop-WithError "no bundle at $bundleDir - build one first: setup_win.bat --bundle"
    }
    $bundleSettings = @{}
    foreach ($line in Get-Content -LiteralPath $bundleEnv) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $bundleSettings[$Matches[1]] = $Matches[2].Trim('"')
        }
    }
    $studioDir = Join-Path $bundleDir 'studio'
    if (-not (Test-Path -LiteralPath (Join-Path $studioDir 'frontend\.next\BUILD_ID'))) {
        Stop-WithError "bundle not set up yet - run: setup_win.bat --bundle  (or: cd $studioDir; setup_win.bat)"
    }
    $bundlePort = $bundleSettings['KIOSK_BUNDLE_PORT']

    if ($Desktop) {
        $app = Join-Path $ElectronDir "out\win-unpacked\$($Kiosk.productName).exe"
        if (-not (Test-Path -LiteralPath $app)) {
            Stop-WithError "no desktop build found at $app - build one first: setup_win.bat --build"
        }
        Write-Info "Launching the desktop shell on the embedded bundle (studio :8080, kiosk :$bundlePort)"
        # External-target mode of the shell (electron/main.js): it runs the
        # bundle's start script and opens the window on the kiosk; the studio
        # that runs it stays reachable from the staff menu (F9) and F2.
        if (-not $env:KIOSK_SHELL_KIOSK_URL) { $env:KIOSK_SHELL_KIOSK_URL = "http://127.0.0.1:$bundlePort" }
        if (-not $env:KIOSK_SHELL_PLATFORM_URL) { $env:KIOSK_SHELL_PLATFORM_URL = 'http://127.0.0.1:8080' }
        if (-not $env:KIOSK_SHELL_URL) { $env:KIOSK_SHELL_URL = $env:KIOSK_SHELL_KIOSK_URL }
        $env:KIOSK_SHELL_CMD = 'start_win.bat'
        $env:KIOSK_SHELL_CWD = $studioDir
        if (-not $env:KIOSK_SHELL_TIMEOUT_SECS) { $env:KIOSK_SHELL_TIMEOUT_SECS = '900' }
        & $app
        exit $LASTEXITCODE
    }

    Write-Info "Starting the embedded bundle (studio :8080, kiosk :$bundlePort, mode: $($bundleSettings['KIOSK_BUNDLE_MODE']))"
    Set-Location -LiteralPath $studioDir
    & cmd.exe /c start_win.bat
    exit $LASTEXITCODE
}

# Each kiosk's dependencies, config and port. --port (or PORT) is the first
# kiosk's port and the rest follow it; otherwise every kiosk has its own.
$portBase = if ($PortArg) { $PortArg } elseif ($env:PORT) { $env:PORT } else { '' }
if ($portBase -and $portBase -notmatch '^\d+$') { Stop-WithError "--port takes a number, not $portBase" }
$Ports = @()
for ($i = 0; $i -lt $KioskDirs.Count; $i++) {
    Use-Kiosk $KioskDirs[$i]
    if ($Desktop) { continue } # the packaged app carries its own server and settings
    Confirm-FrontendDeps
    Confirm-Config
    Confirm-AdminPassword
    $port = if ($portBase) { [int]$portBase + $i } else { Get-KioskPort $KioskDir }
    if ($Ports -contains $port) {
        Stop-WithError "two kiosks want port $port - give them different `"port`" values in kiosk.json, or pass --port"
    }
    $Ports += $port
}
Use-Kiosk $KioskDirs[0]

# 1. Edge AI Studio ---------------------------------------------------------
# Started and waited for by default (a missing checkout is fatal); --wait-studio
# only waits; --no-studio serves regardless of the gateway (the kiosk's health
# page reports what is missing).
if ($Studio -and $StudioAutostart -eq '0') {
    Write-Info 'STUDIO_AUTOSTART=0 - not launching the studio, only waiting for it'
    $Studio = $false; $WaitStudio = $true
}

if ($Mock) {
    Set-MockEnv
} elseif ($Studio) {
    Confirm-Studio
} elseif ($WaitStudio) {
    if (-not (Test-StudioUp)) { Wait-Studio }
    Test-StudioServices
} else {
    Write-Info "Not managing the studio (--no-studio); using whatever is live at $StudioUrl"
    if (Test-StudioUp) { Test-StudioServices }
    else { Write-Warn "studio gateway not reachable at $StudioUrl - the kiosk may show its out-of-service screen" }
}

# 2. Desktop app mode -------------------------------------------------------
# The packaged app carries its own frontend build and pre-seeded database, and
# spawns its own web-server process on a loopback port - so after step 1 we
# just launch the app (the unpacked build under electron\out\).
if ($Desktop) {
    $app = Join-Path $ElectronDir "out\win-unpacked\$($Kiosk.productName).exe"
    if (-not (Test-Path -LiteralPath $app)) {
        $build = "common\scripts\build.bat$(if ($Mock) { ' --mock' }) --kiosk $(Get-KioskId $KioskDir)"
        Stop-WithError "no desktop build found at $app - package one first: $build"
    }
    if ($PortArg) { $env:KIOSK_PORT = $PortArg }
    Write-Info "Launching the desktop kiosk: $app"
    & $app
    exit $LASTEXITCODE
}

$npm = (Get-Command npm -All | Sort-Object { if ($_.Extension -eq '.cmd') { 0 } else { 1 } } | Select-Object -First 1).Source
for ($i = 0; $i -lt $KioskDirs.Count; $i++) {
    Use-Kiosk $KioskDirs[$i]
    $env:PORT = "$($Ports[$i])" # next dev/start listen here; the CMS proxy URL derives from it too
    if ($KioskDirs.Count -gt 1) { Write-Info "Preparing $(Get-KioskLabel $KioskDir)" }

    # 3. Database priming (first run only) ---------------------------------
    # Payload only creates + seeds the SQLite schema outside production, so a fresh
    # checkout needs one dev boot before `next start` can serve.
    $db = Join-Path $FrontendDir 'db.sqlite'
    if (-not ((Test-Path -LiteralPath $db) -and (Get-Item -LiteralPath $db).Length -gt 0)) {
        Write-Info 'No database yet - priming db.sqlite with a one-off dev boot (first run only)'
        $primeLog = Join-Path $KioskDir '.prime.log'
        Remove-Item -LiteralPath $primeLog -Force -ErrorAction SilentlyContinue
        $prime = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$npm`" run dev > `"$primeLog`" 2>&1" `
            -WorkingDirectory $FrontendDir -WindowStyle Hidden -PassThru
        $waited = 0
        try {
            while (-not ((Test-Path -LiteralPath $db) -and (Get-Item -LiteralPath $db).Length -gt 0)) {
                Test-Url "http://localhost:$($Ports[$i])/admin" 5 | Out-Null
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

    # 4. Production build --------------------------------------------------
    if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $FrontendDir '.next\BUILD_ID'))) {
        Write-Info 'Building the frontend (production)'
        Invoke-Npm -NpmArgs @('run', 'build') -WorkingDirectory $FrontendDir
    } else {
        Write-Info 'Reusing existing production build (use --rebuild to force a fresh one)'
    }
}

# 5. Serve ------------------------------------------------------------------
function Show-Banner([int]$Port) {
    Write-Info "Starting $(Get-KioskLabel $KioskDir) at http://localhost:$Port"
    Write-Host "    kiosk UI      http://localhost:$Port"
    Write-Host "    admin (CMS)   http://localhost:$Port/admin  ($(Get-AdminLogin))"
    Write-Host "    health        http://localhost:$Port/api/health"
    Write-Host ''
}

# A settings save at /settings restarts the server: scripts/with-kiosk-env.mjs,
# behind `npm run start`, starts it again on exit code 77.
if ($KioskDirs.Count -eq 1) {
    Show-Banner $Ports[0]
    Invoke-Npm -NpmArgs @('run', 'start') -WorkingDirectory $FrontendDir
    exit 0
}

# Several kiosks: each server is its own process tree on this console. They
# run together and stop together - Ctrl+C reaches every one of them, and the
# finally block takes down whatever is left.
$servers = @()
$code = 0
try {
    for ($i = 0; $i -lt $KioskDirs.Count; $i++) {
        Use-Kiosk $KioskDirs[$i]
        Show-Banner $Ports[$i]
        $env:PORT = "$($Ports[$i])"
        $server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$npm`" run start" `
            -WorkingDirectory $FrontendDir -NoNewWindow -PassThru
        $null = $server.Handle # keeps ExitCode readable once it exits (Windows PowerShell 5.1)
        $servers += $server
    }
    Write-Info 'Ctrl+C stops every kiosk (the studio keeps running)'
    while (-not @($servers | Where-Object { $_.HasExited })) { Start-Sleep -Seconds 1 }
    for ($i = 0; $i -lt $servers.Count; $i++) {
        if ($servers[$i].HasExited) {
            $code = $servers[$i].ExitCode
            Write-Warn "the $(Get-KioskId $KioskDirs[$i]) kiosk stopped (exit $code) - stopping the others"
            break
        }
    }
} finally {
    foreach ($server in $servers) {
        if (-not $server.HasExited) { & taskkill /T /F /PID $server.Id 2>&1 | Out-Null }
    }
}
exit $code
