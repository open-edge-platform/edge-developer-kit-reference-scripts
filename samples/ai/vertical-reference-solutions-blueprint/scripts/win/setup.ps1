#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  One-time setup for the Vertical Reference Solutions Blueprint (Windows).

.DESCRIPTION
  The PowerShell counterpart of setup.sh — same flags, same order:
  npm dependencies for frontend/, and the optional prerequisites. Run it
  through setup_win.bat.

.EXAMPLE
  setup_win.bat
  Install the kiosk's dependencies and set up the Edge AI Studio prerequisite.

.EXAMPLE
  setup_win.bat --yes --skip-studio
  Non-interactive, kiosk dependencies only (the Edge AI Studio is not touched).

.EXAMPLE
  setup_win.bat --build -- --yes --targets=nsis
  Kiosk dependencies, then the desktop build (scripts\build.bat) - no studio.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Yes = $false; $Studio = $null; $PackageStudio = $false
$Hardware = $false; $Bundle = $false; $Build = $false
$BuildArgs = @()

function Show-Usage {
    Write-Host @"
Usage: setup_win.bat [options] [-- <build args>]

Installs what the kiosk needs: npm dependencies for frontend/, then the Edge AI
Studio prerequisite (the AI gateway) from EDGE_AI_STUDIO_DIR - setup fails if
no studio checkout is there. Pass --skip-studio for the kiosk dependencies only
(a terminal that talks to a gateway running elsewhere, or runs with --mock).
The desktop shell (electron/) is not set up here - the build installs its npm
dependencies itself.

Building rather than running natively? setup_win.bat --build installs the kiosk
dependencies and goes straight into scripts\build.bat. The studio checkout must
exist (the build exports the bundle from it) but is not set up - that is only
needed to run the kiosk from this checkout. Add --studio to set it up as well.

Options:
  --yes               non-interactive: assume yes
  --skip-studio       kiosk dependencies only - don't set up the Edge AI Studio
  --studio            accepted for compatibility - setting up the studio
                      (setup_win.bat in the studio checkout) from
                      EDGE_AI_STUDIO_DIR (currently: $EdgeAiStudioDir) is now
                      the default
  --package-studio    set up the studio and build its distributable executable
                      (scripts\win\package.ps1 under EDGE_AI_STUDIO_DIR)
  --bundle            embedded-bundle setup: instead of setting up the studio
                      checkout, export a minimal studio with the kiosk injected
                      as a studio sample into build\kiosk-studio\ and install it
                      (run it with start_win.bat --bundle [--desktop]);
                      the kiosk's terminal mode picks the exported services
                      (touch: OCR+face, LLM remote; chat/agent: all five)
  --build             after the kiosk dependencies, run the production build
                      (scripts\build.bat: the embedded bundle packaged as a
                      desktop app under build\). Implies --skip-studio unless
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
        '^-{1,2}bundle$' { $Bundle = $true }
        '^-{1,2}studio$' { $Studio = $true }
        '^-{1,2}skip-studio$' { $Studio = $false }
        '^-{1,2}package-studio$' { $PackageStudio = $true; $Studio = $true }
        '^-{1,2}hardware$' { $Hardware = $true }
        '^-{1,2}build$' { $Build = $true }
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
# --build only exports from the studio checkout, so it skips the studio's own
# setup unless asked for it explicitly.
if ($null -eq $Studio) { $Studio = -not $Build }

function Confirm-Step([string]$Question) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive) { return $false }
    $reply = Read-Host "$Question [Y/n]"
    return ($reply -notmatch '^(n|no)$')
}

Write-Info 'Vertical Reference Solutions Blueprint setup'
if (($Studio -or $Bundle -or $Build) -and -not (Test-StudioPresent)) {
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

# Admin credentials for the CMS: a fresh checkout ships without a password.
Confirm-Config -Profile $KioskProfile
Confirm-AdminPassword

# 1. Kiosk npm dependencies -------------------------------------------------
Write-Info 'Installing frontend dependencies (frontend/)'
Invoke-Npm -NpmArgs @('install') -WorkingDirectory $FrontendDir

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
    Write-Info 'Building and installing the embedded bundle (build\kiosk-studio)'
    & node (Join-Path $RepoRoot 'scripts\bundle.mjs') --install
    if ($LASTEXITCODE -ne 0) { Stop-WithError "the bundle build failed (exit $LASTEXITCODE)" }
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

    # Preset the services the kiosk needs (LLM, OCR, face, STT, TTS) to
    # auto-start with the model the kiosk's config.yaml expects.
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
    if ($Yes) { $BuildArgs = @('--yes') + $BuildArgs }
    Write-Info 'Building the desktop app (scripts\build.bat)'
    Invoke-DesktopBuild $BuildArgs
}

# 5. Done -------------------------------------------------------------------
Write-Host ''
Write-Ok 'Setup complete.'
Write-Host ''
Write-Host "Admin login (Payload CMS at /admin): $(Get-AdminLogin)"
if ($Build) {
    Write-Host @"

Installer(s) are in build\. Next steps:
  start_win.bat --desktop           launch the packaged app from this checkout
  build\*.exe                       install it on a terminal

Docs: docs/build.md (deploying a terminal, uninstalling)
"@
} else {
    Write-Host @"

Next steps:
  start_win.bat                     start the Edge AI Studio and the kiosk (production build)
  start_win.bat --no-studio         kiosk only, against a gateway that is already up
  scripts\dev\dev.bat               start in development mode (hot reload)
  scripts\dev\dev.bat --mock        development with mocked AI - no studio needed
  scripts\build.bat                 package the kiosk desktop app (.exe / .msi;
                                    installs the electron/ deps itself) - or
                                    setup_win.bat --build to do setup and build in one go

Docs: README.md and docs/ (getting-started, dev-mode, build, configuration)
"@
}
