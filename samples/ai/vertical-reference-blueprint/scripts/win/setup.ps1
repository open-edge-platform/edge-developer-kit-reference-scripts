#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  One-time setup for the Vertical Reference Blueprint (Windows).

.DESCRIPTION
  The PowerShell counterpart of setup.sh — same flags, same order:
  npm dependencies for frontend/ and tauri/, then the Edge AI Studio
  prerequisite. Run it through setup_win.bat.

.EXAMPLE
  setup_win.bat
  Install kiosk deps and set up the Edge AI Studio prerequisite.

.EXAMPLE
  setup_win.bat --yes --skip-studio
  Non-interactive, kiosk dependencies only.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `-- --yes --targets=nsis` into parameter names. $args takes every token
# literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Yes = $false; $SkipStudio = $false; $PackageStudio = $false
$Desktop = $false; $Hardware = $false; $Bundle = $false

function Show-Usage {
    Write-Host @"
Usage: setup_win.bat [options]

Installs everything the blueprint needs to run:
  1. npm dependencies for frontend/ and tauri/
  2. the Edge AI Studio prerequisite (setup_win.bat in the studio checkout)
     from EDGE_AI_STUDIO_DIR (currently: $EdgeAiStudioDir)

Options:
  --yes               non-interactive: assume yes
  --skip-studio       do not set up the Edge AI Studio
  --package-studio    additionally build the studio's distributable executable
                      (scripts\win\package.ps1 under EDGE_AI_STUDIO_DIR)
  --bundle            embedded-bundle setup - Linux only, see docs/embedded-studio.md
  --desktop           check the desktop-bundle toolchain (Rust + MSVC C++ build
                      tools) and print how to install what is missing
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
        '^-{1,2}skip-studio$' { $SkipStudio = $true }
        '^-{1,2}package-studio$' { $PackageStudio = $true }
        '^-{1,2}desktop$' { $Desktop = $true }
        '^-{1,2}hardware$' { $Hardware = $true }
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

function Confirm-Step([string]$Question) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive) { return $false }
    $reply = Read-Host "$Question [Y/n]"
    return ($reply -notmatch '^(n|no)$')
}

Write-Info 'Vertical Reference Blueprint setup'
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

Write-Info 'Installing desktop-shell dependencies (tauri/)'
Invoke-Npm -NpmArgs @('install') -WorkingDirectory $TauriDir

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

if ($Desktop) {
    Write-Info 'Checking the desktop-bundle toolchain (Rust + MSVC C++ build tools)'
    $missing = @()
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $missing += 'the Rust toolchain (https://rustup.rs)' }
    # Tauri links against the MSVC toolchain; without it cargo fails on `link.exe`.
    if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -and
        -not (Test-Path 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe')) {
        $missing += 'Microsoft C++ Build Tools (https://visualstudio.microsoft.com/visual-cpp-build-tools/)'
    }
    if ($missing.Count -eq 0) {
        Write-Ok 'Desktop toolchain is present'
    } else {
        Write-Warn "missing: $($missing -join ', ')"
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Write-Host '    winget install --id Rustlang.Rustup -e'
            Write-Host '    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"'
            if (Confirm-Step 'Install them now with winget?') {
                & winget install --id Rustlang.Rustup -e
                & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools'
                Write-Info 'Open a new terminal so PATH picks up cargo, then re-run this check.'
            }
        } else {
            Write-Host '    Full list of prerequisites: https://tauri.app/start/prerequisites/'
        }
    }
}

# 3. Edge AI Studio prerequisite -------------------------------------------
if ($Bundle) {
    Stop-WithError @"
--bundle is Linux only: the embedded bundle is exported by scripts/bundle.sh,
which drives the studio's export through bash, git and python3. Build it on
Linux (or WSL) and copy build/kiosk-studio over. See docs/embedded-studio.md.
"@
} elseif ($SkipStudio) {
    Write-Info 'Skipping Edge AI Studio setup (--skip-studio)'
} elseif (-not (Test-StudioPresent)) {
    Write-Warn "Edge AI Studio not found at $EdgeAiStudioDir"
    Write-Warn 'Clone it there, or point EDGE_AI_STUDIO_DIR (env var or .kioskrc) at your checkout,'
    Write-Warn 'then re-run setup_win.bat. Without it the kiosk runs in --mock mode only.'
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

# 4. Done -------------------------------------------------------------------
Write-Host ''
Write-Ok 'Setup complete.'
Write-Host @"

Admin login (Payload CMS at /admin): $(Get-AdminLogin)

Next steps:
  start_win.bat                     start the kiosk (production build, studio auto-started)
  scripts\dev\dev.bat               start in development mode (hot reload)
  scripts\dev\dev.bat --mock        development with mocked AI - no studio needed
  build_win.bat                     package the kiosk desktop app (.exe / .msi)

Docs: README.md and docs/ (getting-started, dev-mode, build, configuration)
"@
