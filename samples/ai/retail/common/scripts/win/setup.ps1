#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  One-time setup for the Vertical Reference Solutions Blueprint (Windows).

.DESCRIPTION
  The PowerShell counterpart of setup.sh — same flags, same order: which kiosks
  (asked, or --kiosk), each kiosk frontend's dependencies (<kiosk>\frontend\),
  and the optional prerequisites. Run it
  through setup_win.bat. Every question is asked up front - the build's
  install settings (kiosk mode, window, package format) included - and the
  installs and the build run unattended after.

.EXAMPLE
  setup_win.bat
  Ask what to do (set up only, start, dev or build), which kiosks and where the AI comes from,
  install their dependencies and set up the Edge AI Studio prerequisite.

.EXAMPLE
  setup_win.bat --start
  Set up, then start the kiosks (start_win.bat).

.EXAMPLE
  setup_win.bat --dev --mock
  Set up, then run one kiosk in dev mode with mocked AI (scripts\dev\dev.bat --mock).

.EXAMPLE
  setup_win.bat --kiosk all
  Every kiosk, no question.

.EXAMPLE
  setup_win.bat --yes --skip-studio
  Non-interactive, kiosk dependencies only (the Edge AI Studio is not touched).

.EXAMPLE
  setup_win.bat --build -- --yes --targets=nsis
  Kiosk dependencies, then the desktop build (scripts\build.bat) - no studio.

.EXAMPLE
  setup_win.bat --build --mock
  No studio at all: kiosk dependencies, then each kiosk as a desktop app with its AI mocked.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Yes = $false; $Studio = $null; $PackageStudio = $false
$Hardware = $false; $Bundle = $false; $Build = $false; $Mock = $false; $KioskArg = ''; $Then = ''
$BuildArgs = @()

function Show-Usage {
    Write-Host @"
Usage: setup_win.bat [options] [-- <build args>]

On a terminal, setup first asks what to do - set up only, set up and start,
set up and run one kiosk in dev mode, or set up and build - then which kiosks
and whether the AI comes from the Edge AI Studio or is mocked. Flags answer
up front: --start, --dev, --build; --kiosk; --mock.

Installs what the chosen kiosks ($(Get-KioskIds), or all) need:
each one's frontend dependencies (<kiosk>\frontend\), then the Edge AI
Studio prerequisite (the AI gateway, shared by every kiosk) from
EDGE_AI_STUDIO_DIR - setup fails if no studio checkout is there. Pass
--skip-studio for the kiosk dependencies only (a terminal that talks to a
gateway running elsewhere, or runs with --mock).
The choice is saved, and start_win.bat and uninstall_win.bat follow it.
The desktop shell (electron/) is not set up here - the build installs its npm
dependencies itself.

Building rather than running natively? setup_win.bat --build installs the kiosk
dependencies and goes straight into scripts\build.bat. The studio checkout must
exist (the build exports the bundle from it) but is not set up - that is only
needed to run the kiosk from this checkout. Add --studio to set it up as well.

No studio at all? setup_win.bat --mock installs the kiosk dependencies only, for
start_win.bat --mock; setup_win.bat --build --mock also packages each kiosk as a
desktop app with its AI mocked, for start_win.bat --desktop --mock.

Questions come first: the build's install settings (kiosk mode, window, package
format) are answered before the first npm install - after that, everything runs
unattended.

Options:
  --kiosk <names>     which kiosks, without asking: $(Get-KioskIds) or all,
                      comma separated (default: the saved choice, else
                      $(Get-KioskId (Join-Path $WorkspaceRoot $DefaultKiosk))). <kiosk>\scripts\setup_win.bat sets up that kiosk alone
  --yes               non-interactive: assume yes
  --skip-studio       kiosk dependencies only - don't set up the Edge AI Studio
  --mock              no studio anywhere: --skip-studio, and with --build the
                      kiosk alone is packaged, AI mocked and hardware simulated
                      (scripts\build.bat --mock) - no studio checkout needed
  --studio            accepted for compatibility - setting up the studio
                      (setup_win.bat in the studio checkout) from
                      EDGE_AI_STUDIO_DIR (currently: $EdgeAiStudioDir) is now
                      the default
  --package-studio    set up the studio and build its distributable executable
                      (scripts\win\package.ps1 under EDGE_AI_STUDIO_DIR)
  --bundle            embedded-bundle setup: instead of setting up the studio
                      checkout, export a minimal studio with the kiosk injected
                      as a studio sample into build\kiosk-studio\<kiosk>\ and install it
                      (run it with start_win.bat --bundle [--desktop]);
                      the kiosk's terminal mode picks the exported services
                      (touch: OCR+face, LLM remote; chat/agent: all five)
  --start             after setup, start the kiosks (start_win.bat; with --mock,
                      start_win.bat --mock)
  --dev               after setup, run one kiosk in development mode
                      (scripts\dev\dev.bat, hot reload; with --mock, no studio) -
                      with several kiosks, asks which (or pass --kiosk <name>)
  --build             after the kiosk dependencies, run the production build
                      (scripts\build.bat: the embedded bundle packaged as a
                      desktop app per kiosk under build\). Implies --skip-studio unless
                      --studio is also given. Everything after -- goes to the
                      build (see scripts\build.bat --help); --yes is forwarded
  --hardware          report the peripheral drivers Windows needs (the automated
                      installer is Debian/Ubuntu only)
  --node-version <v>  portable Node.js release to fall back on (default $KioskNodeVersion)
  --profile <name>    which frontend\configs\<name>.yaml to copy to
                      frontend\config.yaml on a fresh checkout (default
                      $KioskProfile; an existing config.yaml is never replaced)
  -h, --help          this help

Studio location is configurable: EDGE_AI_STUDIO_DIR env var or .kioskrc file.
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    switch -Regex ($Arguments[$i]) {
        '^-{1,2}yes$' { $Yes = $true }
        '^-{1,2}kiosk$' {
            $i++
            $KioskArg = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskArg) { Stop-WithError '--kiosk needs a value' }
        }
        '^-{1,2}bundle$' { $Bundle = $true }
        '^-{1,2}studio$' { $Studio = $true }
        '^-{1,2}skip-studio$' { $Studio = $false }
        '^-{1,2}mock$' { $Mock = $true }
        '^-{1,2}package-studio$' { $PackageStudio = $true; $Studio = $true }
        '^-{1,2}hardware$' { $Hardware = $true }
        '^-{1,2}build$' { $Build = $true }
        '^-{1,2}start$' { $Then = 'start' }
        '^-{1,2}dev$' { $Then = 'dev' }
        '^-{1,2}desktop$' { Stop-WithError '--desktop was removed - the build (scripts\build.bat) installs the electron\ dependencies itself' }
        '^--$' {
            $BuildArgs = @(if ($i + 1 -lt $Arguments.Count) { $Arguments[($i + 1)..($Arguments.Count - 1)] })
            $i = $Arguments.Count
        }
        '^-{1,2}node-version$' {
            $i++
            $KioskNodeVersion = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskNodeVersion) { Stop-WithError '--node-version needs a value' }
        }
        '^-{1,2}profile$' {
            $i++
            $KioskProfile = if ($i -lt $Arguments.Count) { $Arguments[$i] } else { '' }
            if (-not $KioskProfile) { Stop-WithError '--profile needs a value' }
        }
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        default { Show-Usage; Stop-WithError "unknown option: $($Arguments[$i])" }
    }
}

if ($BuildArgs.Count -gt 0 -and -not $Build) { Stop-WithError 'arguments after -- go to the build - add --build' }
if ($Build -and $Bundle) { Stop-WithError '--build (packaged desktop app) and --bundle (embedded bundle) are different outputs - pick one' }
if ($Then -and ($Build -or $Bundle)) { Stop-WithError "--$Then runs the kiosks from this checkout - it does not combine with --build or --bundle" }
if ($Mock) {
    if ($Bundle -or $Studio) { Stop-WithError '--mock runs without the studio - it does not combine with --studio, --package-studio or --bundle' }
    $Studio = $false
}

function Confirm-Step([string]$Question) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive) { return $false }
    $reply = Read-Host "$Question [Y/n]"
    return ($reply -notmatch '^(n|no)$')
}

# The kiosk question: numbers, ids or "all"; Enter keeps the current choice.
function Read-KioskChoice {
    $dirs = @(Get-AllKiosks)
    if ($dirs.Count -le 1) { return }
    $current = if ($KioskDirs.Count -eq $dirs.Count) { 'all' } else { Get-SelectedKioskIds }
    Write-Host ''
    Write-Host 'Which kiosks should this checkout run?'
    for ($i = 0; $i -lt $dirs.Count; $i++) {
        Write-Host ('  {0}) {1,-16} {2}' -f ($i + 1), (Get-KioskId $dirs[$i]), (Read-KioskJson $dirs[$i]).studio.title)
    }
    Write-Host ('  {0}) {1,-16} {2}' -f ($dirs.Count + 1), 'all', 'all of the above')
    while ($true) {
        $reply = Read-Host "Pick one or more, e.g. 1 or 1,2 [$($current -replace ', ', ',')]"
        $picked = @()
        $bad = $null
        foreach ($token in @($reply -split '[,\s]+' | Where-Object { $_ })) {
            $number = 0
            if ([int]::TryParse($token, [ref]$number) -and $number -ge 1 -and $number -le $dirs.Count) {
                $picked += Get-KioskId $dirs[$number - 1]
            } elseif ($token -eq 'all' -or $number -eq $dirs.Count + 1) {
                $picked += 'all'
            } elseif (Find-Kiosk $token) {
                $picked += $token
            } else {
                $bad = $token
                break
            }
        }
        if (-not $bad) { break }
        Write-Warn "not one of the choices: $bad"
    }
    if ($picked.Count -gt 0) { Select-Kiosks ($picked -join ' ') }
}

# Read-Choice <question> <default> <name, description, ...> - the picked name;
# takes its number or the name.
function Read-Choice([string]$Question, [string]$Default, [string[]]$Options) {
    $names = @()
    Write-Host ''
    Write-Host $Question
    for ($i = 0; $i -lt $Options.Count; $i += 2) {
        $names += $Options[$i]
        Write-Host ('  {0}) {1,-16} {2}' -f $names.Count, $Options[$i], $Options[$i + 1])
    }
    while ($true) {
        $reply = "$(Read-Host "Pick one [$Default]")".Trim()
        if (-not $reply) { $reply = $Default }
        for ($i = 0; $i -lt $names.Count; $i++) {
            if ($reply -eq "$($i + 1)" -or $reply -eq $names[$i]) { return $names[$i] }
        }
        Write-Warn "not one of the choices: $reply"
    }
}

function Read-Action {
    $choice = Read-Choice 'What would you like to do?' 'setup' @(
        'setup', 'set up only - start, develop or build later',
        'start', 'set up, then start serving (production build), as start_win.bat does',
        'dev', 'set up, then run one kiosk in development mode (hot reload)',
        'build', 'set up, then package desktop apps into build\')
    switch ($choice) {
        { $_ -in 'start', 'dev' } { $script:Then = $choice }
        'build' { $script:Build = $true }
    }
}

function Read-DevKiosk {
    $options = @(foreach ($dir in $KioskDirs) { Get-KioskId $dir; (Read-KioskJson $dir).studio.title })
    $choice = Read-Choice 'Development mode runs one kiosk at a time - which one?' (Get-KioskId $KioskDirs[0]) $options
    $script:DevDir = Find-Kiosk $choice
}

function Read-AiSource {
    $where = "the Edge AI Studio at $EdgeAiStudioDir"
    $default = 'studio'
    if (-not (Test-StudioPresent)) { $where += ' (not found)'; $default = 'mock' }
    while ($true) {
        $choice = Read-Choice 'Where should the AI come from?' $default @(
            'studio', "live AI from $where",
            'mock', 'mocked AI and simulated hardware - no studio needed')
        if ($choice -eq 'mock' -or (Test-StudioPresent)) { break }
        Write-Warn "no studio checkout at $EdgeAiStudioDir - clone it there or set EDGE_AI_STUDIO_DIR in common\.kioskrc, or pick mock (a gateway elsewhere: --skip-studio)"
    }
    if ($choice -eq 'mock') { $script:Mock = $true }
}

Write-Info 'Vertical Reference Solutions Blueprint setup'

# What to do, which kiosks, and where the AI comes from - asked on a terminal
# unless a flag already answered.
$Ask = -not $Yes -and -not [Console]::IsInputRedirected
if ($Ask -and -not $Then -and -not $Build -and -not $Bundle) { Read-Action }

Resolve-Kiosks $KioskArg
if (-not $KioskPinned) {
    if (-not $KioskArg -and -not $env:KIOSKS -and $Ask) {
        Read-KioskChoice
    }
    Save-Kiosks
}
foreach ($dir in $KioskDirs) { Write-Info "Kiosk: $(Get-KioskLabel $dir) - $(Split-Path $dir -Leaf)\" }

$DevDir = $KioskDirs[0]
if ($Then -eq 'dev' -and $KioskDirs.Count -gt 1) {
    if (-not $Ask) { Stop-WithError "--dev runs one kiosk at a time - pick it with --kiosk <$((Get-KioskIds) -replace ', ', '|')>" }
    Read-DevKiosk
}
if ($Ask -and -not $Mock -and $null -eq $Studio -and -not $Bundle) { Read-AiSource }
if ($Mock) { $Studio = $false }

# --build only exports from the studio checkout, so it skips the studio's own
# setup unless asked for it explicitly.
if ($null -eq $Studio) { $Studio = -not $Build }
if (($Studio -or $Bundle -or ($Build -and -not $Mock)) -and -not (Test-StudioPresent)) {
    Stop-WithError @"
Edge AI Studio not found at $EdgeAiStudioDir
Clone it there, or point EDGE_AI_STUDIO_DIR (env var or .kioskrc) at your checkout,
then re-run setup_win.bat. Setting up the studio needs the checkout, and so do
--bundle and --build (they export the bundle from it). Pass --skip-studio to set
up the kiosk alone (it then runs against a gateway elsewhere, or with start_win.bat --mock).
"@
}

# Downloads a portable Node into thirdparty\node when the machine has none
# new enough; every other launcher picks it up from there.
Confirm-Node
Write-Ok "Node $(node -v), npm $(npm -v)"

# Each kiosk's own config.yaml, then its CMS credentials: a fresh checkout ships without a password.
foreach ($dir in $KioskDirs) {
    Use-Kiosk $dir
    Confirm-Config -Profile $KioskProfile
    Confirm-AdminPassword
}
Use-Kiosk $KioskDirs[0]

# 0. Questions ---------------------------------------------------------------
# Everything below this block is unattended work (npm installs, the studio's
# setup, the build), so whatever needs an answer is asked here. Setup itself
# has nothing more to ask on Windows (the studio's system-package step is Linux
# only); the build's questions are the build script's own, asked per kiosk.
# Each answer is the complete argument list for that kiosk's build.
$BuildAnswers = @()
$BuildFlow = if ($Mock) { @('--mock') } else { @('--bundle-app') }
if ($Build) {
    if ($Yes) { $BuildArgs = @('--yes') + $BuildArgs }
    foreach ($dir in $KioskDirs) {
        Use-Kiosk $dir
        if ($KioskDirs.Count -gt 1) { Write-Info "Build settings for $(Get-KioskLabel $dir)" }
        $BuildAnswers += , (Get-BuildAnswers (@($BuildFlow) + @($BuildArgs)))
    }
    Use-Kiosk $KioskDirs[0]
}

# 1. Kiosk npm dependencies -------------------------------------------------
foreach ($dir in $KioskDirs) {
    Write-Info "Installing the $(Get-KioskId $dir) kiosk's dependencies (npm install in $(Join-Path $dir 'frontend'))"
    Invoke-Npm -NpmArgs @('install') -WorkingDirectory (Join-Path $dir 'frontend')
}

# 2. Optional toolchains ----------------------------------------------------
if ($Hardware) {
    Write-Info 'Peripheral drivers on Windows are vendor installers, not a package manager step:'
    Write-Host '    NFC reader   Windows Smart Card service (sc start SCardSvr) + the reader''s own driver'
    Write-Host '    fi-800R      PaperStream IP / TWAIN driver from the Ricoh/PFU download page'
    Write-Host '    OCR raster   poppler for Windows (pdftoppm) on PATH'
    Write-Warn 'frontend/scripts/install-drivers.sh automates this on Debian/Ubuntu only.'
} elseif (-not (Get-Command pdftoppm -ErrorAction SilentlyContinue)) {
    Write-Warn 'pdftoppm (poppler) is missing - live OCR of PDFs will fail. Re-run with --hardware for the pointers.'
}

# 3. Edge AI Studio prerequisite -------------------------------------------
if ($Bundle) {
    # Embedded-bundle path: the studio checkout is only the export source; the
    # runnable copy (minimal studio + injected kiosk sample) lives in build\.
    # The Linux flow's install_dependencies.sh step has no Windows analog - the
    # bundle's own setup_win.bat covers what it needs.
    foreach ($dir in $KioskDirs) {
        Use-Kiosk $dir
        Write-Info "Building and installing the embedded bundle ($(Get-KioskBundleDir))"
        & node (Join-Path $RepoRoot 'scripts\bundle.mjs') --install
        if ($LASTEXITCODE -ne 0) { Stop-WithError "the bundle build failed (exit $LASTEXITCODE)" }
    }
    Use-Kiosk $KioskDirs[0]
} elseif ($Mock) {
    Write-Info 'No Edge AI Studio (--mock) - the AI services are mocked'
} elseif (-not $Studio -and $Build) {
    Write-Info 'Not setting up the Edge AI Studio - the build only exports from its checkout (add --studio to set it up too)'
} elseif (-not $Studio) {
    Write-Info 'Kiosk dependencies only - not setting up the Edge AI Studio (--skip-studio)'
} else {
    Write-Info "Setting up Edge AI Studio at $EdgeAiStudioDir"
    $studioSetup = Join-Path $EdgeAiStudioDir 'setup_win.bat'
    if (-not (Test-Path -LiteralPath $studioSetup)) {
        Stop-WithError "$studioSetup not found - is EDGE_AI_STUDIO_DIR pointing at the studio checkout?"
    }
    Write-Info 'Running the studio''s own setup (thirdparty runtimes, AI workers, gateway build) - this can take a while'
    $setupArgs = @('/c', "`"$studioSetup`"")
    if ($Yes) { $setupArgs += '-AutoYes' }
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $setupArgs -WorkingDirectory $EdgeAiStudioDir -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) { Stop-WithError "the studio's setup failed (exit $($proc.ExitCode))" }
    Write-Ok 'Edge AI Studio is set up'

    # Preset the services each kiosk's deployment.json lists for its terminal mode.
    Install-StudioDeployment

    if ($PackageStudio) {
        $packager = Join-Path $EdgeAiStudioDir 'scripts\win\package.ps1'
        if (-not (Test-Path -LiteralPath $packager)) { Stop-WithError "$packager not found" }
        Write-Info "Packaging the studio executable ($packager)"
        & $packager
        if ($LASTEXITCODE -ne 0) { Stop-WithError "packaging the studio failed (exit $LASTEXITCODE)" }
        Write-Ok "Studio executable: $EdgeAiStudioDir\out\EdgeAIDemoStudio\EdgeAIDemoStudio.exe"
    }
}

# 4. Production build (--build) ---------------------------------------------
if ($Build) {
    for ($i = 0; $i -lt $KioskDirs.Count; $i++) {
        Use-Kiosk $KioskDirs[$i]
        Write-Info "Building the $(Get-KioskLabel $KioskDir) desktop app (scripts\build.bat)"
        Invoke-DesktopBuild (@($BuildFlow) + @($BuildAnswers[$i]))
    }
    Use-Kiosk $KioskDirs[0]
}

# 5. Done -------------------------------------------------------------------
# Commands as the user runs them: the root launchers, or this kiosk's own.
$run = if ($KioskPinned) { "$(Split-Path $KioskDir -Leaf)\scripts\" } else { '' }
$s = if ($KioskDirs.Count -eq 1) { '' } else { 's' }
Write-Host ''
Write-Ok 'Setup complete.'
Write-Host ''
if ($KioskDirs.Count -eq 1) {
    Write-Host "Admin login (Payload CMS at /admin): $(Get-AdminLogin)"
} else {
    Write-Host 'Admin logins (Payload CMS at /admin):'
    foreach ($dir in $KioskDirs) {
        Use-Kiosk $dir
        Write-Host ('  {0,-16} {1}' -f (Get-KioskId $dir), (Get-AdminLogin))
    }
    Use-Kiosk $KioskDirs[0]
}
# A child PowerShell, as in Invoke-DesktopBuild: -File takes the flags literally.
$runArgs = @(if ($Mock) { '--mock' })
$psExe = (Get-Process -Id $PID).Path
if ($Then -eq 'start') {
    Write-Host ''
    Write-Info "Starting the kiosk$s - next time, skip setup: ${run}start_win.bat$(if ($Mock) { ' --mock' })"
    if (-not $KioskPinned) {
        Remove-Item -Path Env:KIOSK_DIR -ErrorAction SilentlyContinue
        $runArgs = @('--kiosk', ((Get-SelectedKioskIds) -replace ' ', '')) + $runArgs
    }
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1') @runArgs
    exit $LASTEXITCODE
} elseif ($Then -eq 'dev') {
    Use-Kiosk $DevDir
    Write-Host ''
    Write-Info "Starting $(Get-KioskLabel $DevDir) in development mode - next time, skip setup: common\scripts\dev\dev.bat --kiosk $(Get-KioskId $DevDir)$(if ($Mock) { ' --mock' })"
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev.ps1') @runArgs
    exit $LASTEXITCODE
}
if ($Build -and $Mock) {
    $pick = if ($s) { ' --kiosk <name>' } else { '' }
    Write-Host @"

Mocked installer(s) are in build\ (*-mock.exe). Next step:
  ${run}start_win.bat --desktop --mock$pick   open the app built last - no studio needed

Docs: common/docs/build.md
"@
} elseif ($Mock) {
    Write-Host @"

Next steps:
  ${run}start_win.bat --mock             start the kiosk$s with mocked AI - no studio needed
  ${run}setup_win.bat --build --mock     or package the kiosk$s as desktop apps, then
  ${run}start_win.bat --desktop --mock   open one

Docs: README.md and common/docs/ (getting-started, dev-mode, build, configuration)
"@
} elseif ($Build) {
    $pick = if ($s) { ' --kiosk <name>' } else { '' }
    Write-Host @"

Installer(s) are in build\. Next steps:
  ${run}start_win.bat --desktop$pick   launch a packaged app from this checkout
  build\*.exe                       install it on a terminal

Docs: common/docs/build.md (deploying a terminal, uninstalling)
"@
} else {
    Write-Host @"

Next steps:
  ${run}start_win.bat               start the Edge AI Studio and the kiosk$s (production build)
  ${run}start_win.bat --no-studio   kiosk$s only, against a gateway that is already up
  ${run}setup_win.bat --build       package the kiosk$s as desktop apps (.exe / .msi; installs the
                                electron/ deps itself)
  common\scripts\dev\dev.bat --kiosk $(if ($s) { '<name>' } else { Get-KioskId $KioskDir })
                                one kiosk in development mode (hot reload; --mock: no studio needed)

Docs: README.md and common/docs/ (getting-started, dev-mode, build, configuration)
"@
}
