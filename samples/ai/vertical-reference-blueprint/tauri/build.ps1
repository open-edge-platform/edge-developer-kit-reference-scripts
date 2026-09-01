#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Bundle the kiosk into a Windows installer (.exe / .msi).

.DESCRIPTION
  Checks the toolchain, then hands over to scripts/build.mjs, which asks for
  the settings the build has to bake in and packages the app.

  Anything not listed below is passed straight through to the build script.

.EXAMPLE
  .\build.ps1
  Ask for the install settings, then build.

.EXAMPLE
  .\build.ps1 --yes --targets=nsis
  Take the defaults from frontend\config.yaml and build one installer .exe.

.EXAMPLE
  .\build.ps1 --mode=touch --windowed --no-build
  Reuse the last kiosk server build.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$BuildArgs = @()
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Write-Fail($message) { Write-Host "X $message" -ForegroundColor Red }
function Write-Dim($message) { Write-Host "  $message" -ForegroundColor DarkGray }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail 'node is not on PATH - the kiosk server is a Node app, and the bundle ships a copy of the runtime you build with.'
    Write-Dim 'Install Node 20 or newer: https://nodejs.org'
    exit 1
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
    Write-Fail "node $(node -v) is too old - Next needs 20 or newer, and this is the runtime that gets bundled."
    exit 1
}

$missing = @()
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $missing += 'the Rust toolchain (https://rustup.rs)' }

# Tauri links against the MSVC toolchain; without it cargo fails on `link.exe`.
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -and
    -not (Test-Path 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe')) {
    $missing += 'Microsoft C++ Build Tools (https://visualstudio.microsoft.com/visual-cpp-build-tools/)'
}

if ($missing.Count -gt 0) {
    Write-Fail "missing: $($missing -join ', ')"
    Write-Host ''
    Write-Dim 'Install these, open a new terminal, and run this script again.'
    Write-Dim 'Full list of prerequisites: https://tauri.app/start/prerequisites/'

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host ''
        Write-Dim 'With winget:'
        Write-Dim '  winget install --id Rustlang.Rustup -e'
        Write-Dim '  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"'
    }
    exit 1
}

# WebView2 is present on Windows 11 and on updated Windows 10, and the NSIS
# installer offers to fetch it when it is not - so this is a warning, not a stop.
$webview2 = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
if (-not (Test-Path $webview2)) {
    Write-Host 'WebView2 was not found on this machine.' -ForegroundColor Yellow
    Write-Dim 'The build still works; the kiosk needs it to run. https://developer.microsoft.com/microsoft-edge/webview2/'
    Write-Host ''
}

# The shipped config.yaml is baked into the package, so it has to exist and
# carry an admin password before the build reads it (a direct run here skips
# the root launchers, where Confirm-Config/Confirm-AdminPassword live).
$kioskConfig = Join-Path $PSScriptRoot '..\frontend\config.yaml'
if (-not (Test-Path -LiteralPath $kioskConfig)) {
    $kioskProfile = if ($env:KIOSK_PROFILE) { $env:KIOSK_PROFILE } else { 'reference' }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\frontend\configs\$kioskProfile.yaml") -Destination $kioskConfig
    Write-Host "Created frontend\config.yaml from the $kioskProfile profile"
}
node ..\scripts\ensure-admin-password.mjs

node scripts/build.mjs @BuildArgs
exit $LASTEXITCODE
