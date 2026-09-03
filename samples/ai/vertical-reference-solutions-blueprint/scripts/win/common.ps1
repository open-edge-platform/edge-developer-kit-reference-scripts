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
$FrontendDir = Join-Path $RepoRoot 'frontend'
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

function Get-Setting([string]$Name, [string]$Default) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

$EdgeAiStudioDir = Get-Setting 'EDGE_AI_STUDIO_DIR' ([IO.Path]::GetFullPath((Join-Path $RepoRoot '..\edge-ai-demo-studio')))
$StudioAutostart = Get-Setting 'STUDIO_AUTOSTART' '1'
$StudioUrl = (Get-Setting 'STUDIO_URL' 'http://localhost:8080').TrimEnd('/')
$StudioWaitSecs = [int](Get-Setting 'STUDIO_WAIT_SECS' '600')
$StudioRunMode = Get-Setting 'STUDIO_RUN_MODE' 'auto'
$StudioDeploymentFile = Get-Setting 'STUDIO_DEPLOYMENT_FILE' ''
$StudioDeploymentManage = Get-Setting 'STUDIO_DEPLOYMENT_MANAGE' '1'
# frontend\config.yaml is per-install and gitignored: the launchers copy it out
# of frontend\configs\ on the first run. reference | hardware | simulated, or
# any other <name>.yaml in that directory.
$KioskProfile = Get-Setting 'KIOSK_PROFILE' 'reference'

function Write-Info([string]$Message) { Write-Host "==> $Message" -ForegroundColor White }
function Write-Ok([string]$Message) { Write-Host " OK  $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "warning: $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) { Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

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
$KioskNodeDir = Get-Setting 'KIOSK_NODE_DIR' (Join-Path $RepoRoot 'thirdparty\node')
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
    Write-Ok "Created frontend\config.yaml from the $Profile profile - edit it for this terminal"
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

function Confirm-FrontendDeps {
    if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'node_modules'))) {
        Write-Warn 'frontend dependencies are missing (did you run setup_win.bat?) - installing now'
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

# Mirrors kiosk_terminal_mode in common.sh: env var, then config.local.yaml,
# then config.yaml, then the KIOSK_PROFILE preset, then the touch fallback.
# The `mode:` read here is the one inside the top-level `terminal:` block only
# (the scanner block has its own); frontend/src/lib/kiosk-config.ts is the
# source of truth for that shape.
function Get-KioskTerminalMode {
    if (-not [string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_KIOSK_MODE)) { return $env:NEXT_PUBLIC_KIOSK_MODE }
    foreach ($file in @(
            (Join-Path $FrontendDir 'config.local.yaml'),
            (Join-Path $FrontendDir 'config.yaml'),
            (Join-Path $FrontendDir "configs\$KioskProfile.yaml"))) {
        if (-not (Test-Path -LiteralPath $file)) { continue }
        $inTerminal = $false
        foreach ($line in Get-Content -LiteralPath $file) {
            if ($line -match '^terminal:') { $inTerminal = $true; continue }
            if ($line -match '^[A-Za-z_]') { $inTerminal = $false }
            if ($inTerminal -and $line -match '^\s+mode:\s*["'']?([A-Za-z0-9_-]+)') { return $Matches[1] }
        }
    }
    return 'touch'
}

function Get-StudioDeploymentFile {
    if (-not [string]::IsNullOrWhiteSpace($StudioDeploymentFile)) { return $StudioDeploymentFile }
    if ((Get-KioskTerminalMode) -eq 'touch') {
        return (Join-Path $RepoRoot 'scripts\studio-deployment.touch.json')
    }
    return (Join-Path $RepoRoot 'scripts\studio-deployment.chat.json')
}

# Install the kiosk's service presets as the studio's deployment.json so the
# services the kiosk needs auto-start with the model/devices it expects.
# Whatever is at the target is replaced (the previous file is kept as .bak);
# set STUDIO_DEPLOYMENT_MANAGE=0 to keep a hand-managed file untouched.
function Install-StudioDeployment {
    if ($StudioDeploymentManage -ne '1') { return }
    if (-not (Test-StudioPresent)) { return }

    $file = Get-StudioDeploymentFile
    if (-not (Test-Path -LiteralPath $file)) { Write-Warn "deployment template not found: $file"; return }
    $target = Join-Path $EdgeAiStudioDir 'deployment.json'

    $sameAs = {
        param($a, $b)
        if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
        (Get-FileHash -LiteralPath $a).Hash -eq (Get-FileHash -LiteralPath $b).Hash
    }

    if (& $sameAs $target $file) {
        Write-Info "Studio deployment.json already matches the $(Split-Path $file -Leaf) profile"
        return
    }
    if (Test-Path -LiteralPath $target) {
        Copy-Item -LiteralPath $target -Destination "$target.bak" -Force
    }
    Copy-Item -LiteralPath $file -Destination $target -Force
    Write-Ok "Installed $(Split-Path $file -Leaf) presets into $target (kiosk mode: $(Get-KioskTerminalMode))"
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
    $mode = Get-KioskTerminalMode
    $allOk = $true
    $checks = [ordered]@{
        'text-generation'  = "$StudioUrl/api/text-generation/v1/models"
        'ocr'              = "$StudioUrl/api/ocr/healthcheck"
        'face-recognition' = "$StudioUrl/api/face-recognition/healthcheck"
    }
    if ($mode -ne 'touch') {
        $checks['speech-to-text'] = "$StudioUrl/api/speech-to-text/healthcheck"
        $checks['text-to-speech'] = "$StudioUrl/api/text-to-speech/healthcheck"
    }
    foreach ($name in $checks.Keys) {
        if (-not (Test-ServiceUp $checks[$name])) {
            Write-Warn "studio service '$name' is not active"
            $allOk = $false
        }
    }
    if ($allOk) {
        Write-Ok "All studio AI services required for '$mode' mode are reachable"
    } else {
        Write-Warn "Some AI services are not running. Start them in the studio UI ($StudioUrl),"
        Write-Warn 'or restart the studio so it applies the auto-start presets in'
        Write-Warn "$EdgeAiStudioDir\deployment.json (installed from $(Get-StudioDeploymentFile))."
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
function Invoke-DesktopBuild([string[]]$BuildArgs) {
    $builder = Join-Path $ElectronDir 'build.ps1'
    if (-not (Test-Path -LiteralPath $builder)) { Stop-WithError "$builder not found" }
    $psExe = (Get-Process -Id $PID).Path
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $builder --bundle-app @BuildArgs
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
