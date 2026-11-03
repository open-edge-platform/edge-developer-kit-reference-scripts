# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$AppName     = 'pallet-defect-detection'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteDir    = Join-Path $ScriptDir 'src'
$ComposeFile = Join-Path $SuiteDir 'docker-compose.yml'
$EnvFile     = Join-Path $SuiteDir '.env'
$OverrideDst = Join-Path $ScriptDir 'compose.override.yml'

function Log($msg) { Write-Host "[$AppName] $msg" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Log 'Docker is not available; nothing to stop.'
  exit 0
}

if (-not (Test-Path $ComposeFile)) {
  Log "Compose file not found at $ComposeFile; nothing to stop."
  exit 0
}

$ComposeArgs = @()
if (Test-Path $EnvFile) { $ComposeArgs += @('--env-file', $EnvFile) }
$ComposeArgs += @('-f', $ComposeFile)
if ((Test-Path $OverrideDst) -and (Get-Item $OverrideDst).Length -gt 0) {
  $ComposeArgs += @('-f', $OverrideDst)
}

Log 'Stopping docker compose stack'
Push-Location $SuiteDir
try {
  docker compose @ComposeArgs down --remove-orphans -v
}
finally {
  Pop-Location
}
