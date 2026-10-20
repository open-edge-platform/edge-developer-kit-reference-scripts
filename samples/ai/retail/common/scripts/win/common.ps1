#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Shared helpers for the vertical-reference-solutions-blueprint launcher scripts on Windows.

.DESCRIPTION
  The PowerShell counterpart of scripts/common.sh — same settings, same
  precedence (env var, then .kioskrc, then default). Dot-sourced, not executed.
#>

$ErrorActionPreference = 'Stop'

$script:ScriptDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WorkspaceRoot = (Resolve-Path (Join-Path $RepoRoot '..')).Path
$ElectronDir = Join-Path $RepoRoot 'electron'
$StudioLog = Join-Path $RepoRoot '.studio.log'

# .kioskrc is a shell file shared with the bash launchers; PowerShell cannot
# source it, so read the KEY=value lines it realistically holds.
function Import-KioskRc {
    $rc = Join-Path $RepoRoot '.kioskrc'
    if (-not (Test-Path -LiteralPath $rc)) { return }
    foreach ($line in Get-Content -LiteralPath $rc) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $value = $value -replace '\$HOME', $HOME -replace '\$\{HOME\}', $HOME
        if (-not (Test-Path "Env:$name")) { Set-Item -Path "Env:$name" -Value $value }
    }
}
Import-KioskRc

# The kiosk the launchers drive: a repo-root folder with kiosk.json and frontend\.
# Each kiosk folder's own launchers pin it; the root launchers pick from the
# selection setup_win.bat saved (Resolve-Kiosks). Relative values resolve against the repo root.
$DefaultKiosk = 'public-service-kiosk'
$KioskSelectionFile = Join-Path $RepoRoot '.kiosks'
$KioskPinned = -not [string]::IsNullOrWhiteSpace($env:KIOSK_DIR)
$KioskDir = if ($KioskPinned) { $env:KIOSK_DIR } else { $DefaultKiosk }
if (-not [IO.Path]::IsPathRooted($KioskDir)) { $KioskDir = Join-Path $WorkspaceRoot $KioskDir }
if (-not (Test-Path -LiteralPath (Join-Path $KioskDir 'kiosk.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $KioskDir 'frontend\package.json'))) {
    Write-Host "error: $KioskDir is not a kiosk folder (needs kiosk.json and frontend\)" -ForegroundColor Red
    exit 1
}
$KioskDir = (Resolve-Path -LiteralPath $KioskDir).Path
$env:KIOSK_DIR = $KioskDir
$FrontendDir = Join-Path $KioskDir 'frontend'
$Kiosk = Get-Content -LiteralPath (Join-Path $KioskDir 'kiosk.json') -Raw | ConvertFrom-Json
$KioskDirs = @($KioskDir)
# Packages and embedded bundles of every kiosk, at the repo root.
$BuildDir = Join-Path $WorkspaceRoot 'build'

function Get-Setting([string]$Name, [string]$Default) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

# Relative path settings resolve against common\, where .kioskrc lives - never the caller's cwd.
function Resolve-KitPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path)) { return $Path }
    return [IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

$EdgeAiStudioDir = Resolve-KitPath (Get-Setting 'EDGE_AI_STUDIO_DIR' ([IO.Path]::GetFullPath((Join-Path $RepoRoot '..\..\edge-ai-demo-studio'))))
$StudioAutostart = Get-Setting 'STUDIO_AUTOSTART' '1'
$StudioUrl = (Get-Setting 'STUDIO_URL' 'http://localhost:8080').TrimEnd('/')
$StudioWaitSecs = [int](Get-Setting 'STUDIO_WAIT_SECS' '600')
$StudioRunMode = Get-Setting 'STUDIO_RUN_MODE' 'auto'
$StudioDeploymentFile = Resolve-KitPath (Get-Setting 'STUDIO_DEPLOYMENT_FILE' '')
$StudioDeploymentManage = Get-Setting 'STUDIO_DEPLOYMENT_MANAGE' '1'
# frontend\config.yaml is per-install and gitignored: the launchers copy it out
# of frontend\configs\ on the first run. reference | hardware | simulated, or
# any other <name>.yaml in that directory.
$KioskProfile = Get-Setting 'KIOSK_PROFILE' 'reference'

function Write-Info([string]$Message) { Write-Host "==> $Message" -ForegroundColor White }
function Write-Ok([string]$Message) { Write-Host " OK  $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "warning: $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) { Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# Kiosk selection - the counterpart of the helpers in scripts/common.sh
# ---------------------------------------------------------------------------

function Test-KioskDir([string]$Dir) {
    (Test-Path -LiteralPath (Join-Path $Dir 'kiosk.json')) -and
        (Test-Path -LiteralPath (Join-Path $Dir 'frontend\package.json'))
}

function Read-KioskJson([string]$Dir) {
    Get-Content -LiteralPath (Join-Path $Dir 'kiosk.json') -Raw | ConvertFrom-Json
}

function Get-KioskId([string]$Dir) { (Read-KioskJson $Dir).id }

# "Hospital Concierge Kiosk (healthcare)" for messages.
function Get-KioskLabel([string]$Dir) {
    $k = Read-KioskJson $Dir
    "$($k.studio.title) ($($k.id))"
}

# Every kiosk folder in the repo, the default one first.
function Get-AllKiosks {
    $default = Join-Path $WorkspaceRoot $DefaultKiosk
    if (Test-KioskDir $default) { (Resolve-Path -LiteralPath $default).Path }
    foreach ($dir in Get-ChildItem -LiteralPath $WorkspaceRoot -Directory | Sort-Object Name) {
        if ($dir.Name -ne $DefaultKiosk -and (Test-KioskDir $dir.FullName)) { $dir.FullName }
    }
}

function Get-KioskIds { (@(Get-AllKiosks) | ForEach-Object { Get-KioskId $_ }) -join ', ' }

function Find-Kiosk([string]$Name) { # a kiosk.json id or a folder name
    $Name = $Name.TrimEnd('\', '/')
    foreach ($dir in @(Get-AllKiosks)) {
        if ($Name -eq (Get-KioskId $dir) -or $Name -eq (Split-Path $dir -Leaf)) { return $dir }
    }
    return $null
}

# $KioskDirs from "all" or names separated by commas/spaces, in repo order.
function Select-Kiosks([string]$Spec, [string]$From = '') {
    $where = if ($From) { " (from $From)" } else { '' }
    $all = $false
    $wanted = @{}
    foreach ($name in @($Spec -split '[,\s]+' | Where-Object { $_ })) {
        if ($name -eq 'all') { $all = $true; continue }
        $dir = Find-Kiosk $name
        if (-not $dir) { Stop-WithError "no such kiosk: $name$where - pick from: $(Get-KioskIds), all" }
        $wanted[$dir] = $true
    }
    $script:KioskDirs = @(@(Get-AllKiosks) | Where-Object { $all -or $wanted.ContainsKey($_) })
    if ($script:KioskDirs.Count -eq 0) { Stop-WithError "no kiosk selected$where" }
}

# The saved selection, space separated; empty when there is none.
function Get-SavedKiosks {
    if (-not (Test-Path -LiteralPath $KioskSelectionFile)) { return '' }
    $names = foreach ($line in Get-Content -LiteralPath $KioskSelectionFile) {
        $name = ($line -replace '#.*$', '').Trim()
        if ($name) { $name }
    }
    return (@($names) -join ' ')
}

function Save-Kiosks {
    Set-Content -LiteralPath $KioskSelectionFile -Encoding ascii `
        -Value @($KioskDirs | ForEach-Object { Get-KioskId $_ })
}

function Get-SelectedKioskIds { (@($KioskDirs) | ForEach-Object { Get-KioskId $_ }) -join ', ' }

# Point the helpers, and every child process, at one kiosk.
function Use-Kiosk([string]$Dir) {
    $script:KioskDir = $Dir
    $script:FrontendDir = Join-Path $Dir 'frontend'
    $script:Kiosk = Read-KioskJson $Dir
    $env:KIOSK_DIR = $Dir
}

# The kiosks a root launcher drives: --kiosk, else $env:KIOSKS (or .kioskrc),
# else the selection setup_win.bat saved, else the default kiosk. A pinned
# KIOSK_DIR (<kiosk>\scripts\*_win.bat) drives that kiosk alone.
function Resolve-Kiosks([string]$KioskArg = '') {
    if ($KioskPinned) {
        if ($KioskArg) {
            Stop-WithError "--kiosk is for the root launchers - $(Split-Path $KioskDir -Leaf)'s own scripts always drive that kiosk"
        }
        $script:KioskDirs = @($KioskDir)
        return
    }
    $saved = Get-SavedKiosks
    if ($KioskArg) { Select-Kiosks $KioskArg '--kiosk' }
    elseif ($env:KIOSKS) { Select-Kiosks $env:KIOSKS 'KIOSKS' }
    elseif ($saved) { Select-Kiosks $saved $KioskSelectionFile }
    else { Select-Kiosks $DefaultKiosk }
    Use-Kiosk $script:KioskDirs[0]
}

# The port a kiosk serves on from this checkout: kiosk.json "port", else 3000.
function Get-KioskPort([string]$Dir) {
    $port = (Read-KioskJson $Dir).port
    if ($port) { return [int]$port }
    return 3000
}

# Where scripts/bundle.mjs exports the current kiosk's embedded bundle.
function Get-KioskBundleDir {
    $default = Join-Path $BuildDir "kiosk-studio\$($Kiosk.id)"
    Resolve-KitPath $(if ($env:KIOSK_BUNDLE_DIR) { $env:KIOSK_BUNDLE_DIR } else { $default })
}

# The build's questions for the current kiosk, answered now: the full argument
# list for its build, so the build has nothing left to ask.
# The first of $BuildArgs is the flow: --bundle-app, or --mock for the kiosk alone.
function Get-BuildAnswers([string[]]$BuildArgs) {
    $asker = Join-Path $ElectronDir 'scripts\build.mjs'
    $answers = @(& node $asker --ask-only @BuildArgs)
    if ($LASTEXITCODE -ne 0) { Stop-WithError "the build's questions failed (exit $LASTEXITCODE)" }
    if ($answers.Count -eq 0) { Stop-WithError "the build's questions were not answered" }
    return , $answers
}

# npm/npx are .cmd shims on Windows; PowerShell resolves them, cmd-launched
# child processes do not.
function Invoke-Npm {
    param([string[]]$NpmArgs, [string]$WorkingDirectory = $RepoRoot)
    $npm = Get-Command npm -All -ErrorAction SilentlyContinue |
        Sort-Object { if ($_.Extension -eq '.cmd') { 0 } else { 1 } } |
        Select-Object -First 1
    if (-not $npm) { Stop-WithError 'npm is not on PATH. Install Node.js 20 or newer (https://nodejs.org).' }
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $npm.Source @NpmArgs
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0) { Stop-WithError "npm $($NpmArgs -join ' ') failed in $WorkingDirectory (exit $code)" }
}

# ---------------------------------------------------------------------------
# Node.js - the machine's, or a portable one unpacked into thirdparty\node
# ---------------------------------------------------------------------------
# The counterpart of scripts/common.sh: setup_win.bat downloads a private Node
# when the machine has none new enough, and the other launchers pick it up.
$NodeMinMajor = 20
$KioskNodeVersion = Get-Setting 'KIOSK_NODE_VERSION' 'v22.18.0'
$KioskNodeDir = Resolve-KitPath (Get-Setting 'KIOSK_NODE_DIR' (Join-Path $RepoRoot 'thirdparty\node'))
$KioskNodeMirror = (Get-Setting 'KIOSK_NODE_MIRROR' 'https://nodejs.org/dist').TrimEnd('/')

function Test-NodeUsable {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    try { $major = [int](node -p 'process.versions.node.split(".")[0]') } catch { return $false }
    return ($major -ge $NodeMinMajor)
}

# Put an already-downloaded portable Node first on PATH (npm ships beside it).
function Use-PortableNode {
    if (-not (Test-Path -LiteralPath (Join-Path $KioskNodeDir 'node.exe'))) { return $false }
    if (($env:PATH -split ';') -notcontains $KioskNodeDir) {
        $env:PATH = "$KioskNodeDir;$env:PATH"
    }
    return $true
}

function Install-PortableNode {
    $archive = "node-$KioskNodeVersion-win-x64.zip"
    $url = "$KioskNodeMirror/$KioskNodeVersion/$archive"
    Write-Info "No usable Node.js found - downloading a portable one ($KioskNodeVersion, win-x64)"

    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('kiosk-node-' + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        $zip = Join-Path $temp $archive
        $sums = Join-Path $temp 'SHASUMS256.txt'
        # The progress bar makes Invoke-WebRequest an order of magnitude slower.
        $previous = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
            Invoke-WebRequest -Uri "$KioskNodeMirror/$KioskNodeVersion/SHASUMS256.txt" -OutFile $sums -UseBasicParsing
        } finally {
            $ProgressPreference = $previous
        }

        $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match "\s\*?$([regex]::Escape($archive))$" } | Select-Object -First 1
        if (-not $line) { Stop-WithError "no checksum for $archive in SHASUMS256.txt" }
        $expected = ($line -split '\s+')[0]
        $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
        if ($actual -ne $expected.ToUpper()) {
            Stop-WithError "checksum mismatch for $archive (expected $expected, got $actual)"
        }

        $unpacked = Join-Path $temp 'unpacked'
        Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
        $inner = Get-ChildItem -LiteralPath $unpacked -Directory | Select-Object -First 1
        if (-not $inner) { Stop-WithError "unexpected layout in $archive" }

        if (Test-Path -LiteralPath $KioskNodeDir) { Remove-Item -LiteralPath $KioskNodeDir -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KioskNodeDir) | Out-Null
        Move-Item -LiteralPath $inner.FullName -Destination $KioskNodeDir
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Use-PortableNode)) { Stop-WithError "no node.exe under $KioskNodeDir after extraction" }
    if (-not (Test-NodeUsable)) { Stop-WithError 'the downloaded Node.js does not run on this machine' }
    Write-Ok "Portable Node $(node -v) installed at $KioskNodeDir"
}

# Strict check for the scripts that only run the kit (start/dev/build).
function Assert-Node {
    if (Test-NodeUsable) { return }
    if ((Use-PortableNode) -and (Test-NodeUsable)) { return }
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Stop-WithError "Node.js >= $NodeMinMajor is required - found $(node -v). Run setup_win.bat to unpack a portable one into thirdparty\node, or upgrade yours (https://nodejs.org)."
    }
    Stop-WithError "node is not on PATH. Run setup_win.bat to unpack a portable one into thirdparty\node, or install Node.js $NodeMinMajor or newer (https://nodejs.org)."
}

# Setup's variant: download a portable Node instead of refusing to continue.
function Confirm-Node {
    if (Test-NodeUsable) { return }
    if ((Use-PortableNode) -and (Test-NodeUsable)) { return }
    Install-PortableNode
}

# Materialise frontend\config.yaml from a committed profile. An existing one is
# never overwritten - it is the terminal's own settings.
function Confirm-Config {
    param([string]$Profile = $KioskProfile)
    $target = Join-Path $FrontendDir 'config.yaml'
    if (Test-Path -LiteralPath $target) { return }
    $source = Join-Path $FrontendDir "configs\$Profile.yaml"
    if (-not (Test-Path -LiteralPath $source)) {
        $available = (Get-ChildItem -LiteralPath (Join-Path $FrontendDir 'configs') -Filter '*.yaml' |
            ForEach-Object { $_.BaseName }) -join ' '
        Stop-WithError "no such profile: $Profile (looked for $source; try: $available)"
    }
    Copy-Item -LiteralPath $source -Destination $target
    Write-Ok "Created $target from the $Profile profile - edit it for this terminal"
}

# The Payload admin password: config.yaml arrives without one, and the first
# setup/start fills it with a crypto-random value
# (scripts/ensure-admin-password.mjs). Needs node - call after Assert-Node.
function Confirm-AdminPassword {
    param([string[]]$ScriptArgs = @())
    $generator = Join-Path $RepoRoot 'scripts\ensure-admin-password.mjs'
    if (-not (Test-Path -LiteralPath $generator)) { return }
    & node $generator @ScriptArgs
}

# "<email> / <password>" for the launcher banners.
function Get-AdminLogin {
    $generator = Join-Path $RepoRoot 'scripts\ensure-admin-password.mjs'
    $login = ''
    if (Test-Path -LiteralPath $generator) {
        # A native command's stderr becomes a terminating error once captured.
        try { $login = (& node $generator '--print' 2>$null) -join '' } catch { $login = '' }
    }
    if ([string]::IsNullOrWhiteSpace($login)) {
        return 'see cms.admin_email / cms.admin_password in frontend/config.yaml'
    }
    return $login
}

# Native stderr becomes a terminating error under $ErrorActionPreference =
# 'Stop', so relax it around the call and judge success by the exit code.
function Test-FrontendDepsPresent {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & node -e "for (const p of ['next','yaml','payload']) require.resolve(p, { paths: [process.argv[1]] })" $FrontendDir 2>$null | Out-Null
    } finally {
        $ErrorActionPreference = $previous
    }
    return ($LASTEXITCODE -eq 0)
}

function Confirm-FrontendDeps {
    if (-not (Test-FrontendDepsPresent)) {
        Write-Warn 'the kiosk''s dependencies are missing (did you run setup_win.bat?) - installing now'
        Invoke-Npm -NpmArgs @('install') -WorkingDirectory $FrontendDir
    }
}

# ---------------------------------------------------------------------------
# Edge AI Studio helpers
# ---------------------------------------------------------------------------

function Test-StudioPresent { Test-Path -LiteralPath $EdgeAiStudioDir -PathType Container }

function Test-Url([string]$Url, [int]$TimeoutSec = 5) {
    try {
        $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return $true
    } catch {
        return $false
    }
}

function Test-StudioUp { Test-Url "$StudioUrl/api/services" 5 }

function Get-StudioPackagedBin {
    $bin = Join-Path $EdgeAiStudioDir 'out\EdgeAIDemoStudio\EdgeAIDemoStudio.exe'
    if (Test-Path -LiteralPath $bin) { return $bin }
    return $null
}

# Mirrors studio_deployment in common.sh: install <studio dir> | services, for every selected kiosk.
function Invoke-StudioDeployment([string]$Command, [string[]]$Extra = @()) {
    Assert-Node
    $cli = @($Command, '--profile', $KioskProfile)
    # Windows PowerShell drops empty native arguments, so --file only when set.
    if (-not [string]::IsNullOrWhiteSpace($StudioDeploymentFile)) { $cli += @('--file', $StudioDeploymentFile) }
    $cli += $Extra + @($KioskDirs)
    $output = & node (Join-Path $RepoRoot 'scripts\studio-deployment.mjs') @cli
    if ($LASTEXITCODE -ne 0) { exit 1 }
    return $output
}

function Install-StudioDeployment {
    if ($StudioDeploymentManage -ne '1') { return }
    if (-not (Test-StudioPresent)) { return }
    Invoke-StudioDeployment 'install' @($EdgeAiStudioDir) | ForEach-Object { Write-Host $_ }
}

function Start-Studio {
    if (-not (Test-StudioPresent)) {
        Stop-WithError @"
Edge AI Studio not found at $EdgeAiStudioDir
Set EDGE_AI_STUDIO_DIR (env var or .kioskrc) to your checkout, or pass --no-studio
(the kiosk then serves against whatever gateway is live) / --mock.
"@
    }

    Install-StudioDeployment

    $bin = $null
    switch ($StudioRunMode) {
        'packaged' {
            $bin = Get-StudioPackagedBin
            if (-not $bin) {
                Stop-WithError "No packaged studio executable under $EdgeAiStudioDir\out - build it with: $EdgeAiStudioDir\scripts\win\package.ps1"
            }
        }
        'auto' { $bin = Get-StudioPackagedBin }
        'headless' { $bin = $null }
        default { Stop-WithError "STUDIO_RUN_MODE must be auto, packaged, or headless (got: $StudioRunMode)" }
    }

    if ($bin) {
        Write-Info "Starting Edge AI Studio (packaged app): $bin"
        Start-Process -FilePath $bin -WorkingDirectory (Split-Path $bin -Parent) `
            -RedirectStandardOutput $StudioLog -RedirectStandardError "$StudioLog.err" | Out-Null
    } else {
        $launcher = Join-Path $EdgeAiStudioDir 'start_win.bat'
        if (-not (Test-Path -LiteralPath $launcher)) {
            Stop-WithError "$launcher not found - is EDGE_AI_STUDIO_DIR pointing at the studio checkout?"
        }
        Write-Info "Starting Edge AI Studio (headless server) from $EdgeAiStudioDir"
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$launcher`"" `
            -WorkingDirectory $EdgeAiStudioDir -WindowStyle Hidden `
            -RedirectStandardOutput $StudioLog -RedirectStandardError "$StudioLog.err" | Out-Null
    }
    Write-Info "Studio output: $StudioLog"
}

function Wait-Studio {
    Write-Info "Waiting for the studio gateway at $StudioUrl (up to ${StudioWaitSecs}s - the first launch loads AI models and is slow)"
    $waited = 0
    while (-not (Test-StudioUp)) {
        Start-Sleep -Seconds 5
        $waited += 5
        if ($waited -ge $StudioWaitSecs) {
            Stop-WithError "Studio gateway did not come up within ${StudioWaitSecs}s - check $StudioLog"
        }
    }
    Write-Ok "Studio gateway is up at $StudioUrl"
}

# The kiosk's health semantics: any HTTP reply < 500 counts as up (the gateway
# answers 500 for an inactive service, 404 for a path a live worker doesn't serve).
function Test-ServiceUp([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return [int]$response.StatusCode -lt 500
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status) { return [int]$status -lt 500 }
        return $false
    }
}

function Test-StudioServices {
    $allOk = $true
    foreach ($name in @(Invoke-StudioDeployment 'services')) {
        $url = if ($name -eq 'text-generation') { "$StudioUrl/api/text-generation@text-generation/v1/models" } else { "$StudioUrl/api/$($name)@$($name)/healthcheck" }
        if (-not (Test-ServiceUp $url)) {
            Write-Warn "studio service '$name' is not active"
            $allOk = $false
        }
    }
    if ($allOk) {
        Write-Ok "All studio AI services the kiosks' deployment.json runs are reachable"
    } else {
        Write-Warn "Some AI services are not running. Start them in the studio UI ($StudioUrl),"
        Write-Warn 'or restart the studio so it applies the auto-start presets in'
        Write-Warn "$EdgeAiStudioDir\deployment.json."
        Write-Warn 'LLM + OCR down is fatal for document flows unless you run with -Mock.'
    }
}

function Confirm-Studio {
    if (Test-StudioUp) {
        Write-Ok "Edge AI Studio gateway already running at $StudioUrl"
        Install-StudioDeployment # presets apply on the studio's next restart
    } else {
        Start-Studio
        Wait-Studio
    }
    Test-StudioServices
}

# The shell's build.ps1 checks the toolchain, asks the install questions,
# exports the bundle (scripts/bundle.mjs) and packages it, so the questions
# come before the long work — the counterpart of scripts/build.sh's
# `electron/build.sh --bundle-app`. It runs in a child PowerShell rather than
# `& $builder @BuildArgs`: splatting into a script binds `--targets=nsis` as a
# parameter name, while -File takes it literally.
# The first of $BuildArgs is the flow, as for Get-BuildAnswers.
function Invoke-DesktopBuild([string[]]$BuildArgs) {
    $builder = Join-Path $ElectronDir 'build.ps1'
    if (-not (Test-Path -LiteralPath $builder)) { Stop-WithError "$builder not found" }
    $psExe = (Get-Process -Id $PID).Path
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $builder @BuildArgs
    if ($LASTEXITCODE -ne 0) { Stop-WithError "the desktop build failed (exit $LASTEXITCODE)" }
    Write-Ok 'Installer(s) copied to build\'
}

function Set-MockEnv {
    # Zero-dependency demo mode: no AI gateway, no verification gate. The
    # gateway URLs are blanked so those services count as intentionally "off" -
    # a configured but unreachable service would fail /api/health and put the
    # kiosk out of service.
    $env:KIOSK_LLM_MOCK = 'true'
    $env:KIOSK_REQUIRE_DOCUMENT_VERIFICATION = 'false'
    foreach ($name in @('KIOSK_OCR_BASE_URL', 'KIOSK_FACE_BASE_URL', 'KIOSK_STT_BASE_URL', 'KIOSK_TTS_BASE_URL')) {
        Set-Item -Path "Env:$name" -Value ''
        # An empty value means "off"; a *missing* one falls back to config.yaml's
        # live URL, which fails /api/health and puts the kiosk out of service.
        if ($null -eq (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) {
            Write-Warn "$name could not be blanked in this shell - the kiosk may show its out-of-service screen"
        }
    }
    # config.yaml is strict about hardware and face matching (face.require_match:
    # true, nfc/scanner simulate: never) - right for a real terminal, fatal
    # without one. Env beats config.yaml, so relax exactly those three here.
    $env:KIOSK_FACE_REQUIRE_MATCH = 'false'
    $env:KIOSK_NFC_SIMULATE = 'auto'
    $env:KIOSK_SCANNER_SIMULATE = 'auto'
    Write-Info 'Mock mode: LLM mocked, document verification off, gateway services disabled, hardware simulated'
}
