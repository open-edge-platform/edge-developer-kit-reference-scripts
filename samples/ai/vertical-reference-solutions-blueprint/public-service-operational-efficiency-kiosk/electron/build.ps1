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
    Write-Fail 'node is not on PATH - the kiosk server is a Node app and the shell''s build runs on it.'
    Write-Dim 'Install Node 20 or newer: https://nodejs.org'
    exit 1
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
    Write-Fail "node $(node -v) is too old - Next needs 20 or newer."
    exit 1
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
