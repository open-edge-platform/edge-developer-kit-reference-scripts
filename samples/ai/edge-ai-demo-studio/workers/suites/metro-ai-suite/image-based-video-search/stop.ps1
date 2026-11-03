# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$AppName = 'image-based-video-search'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteDir = Join-Path $ScriptDir 'src'
$ComposeFile = Join-Path $SuiteDir 'compose.yml'
$OverrideFile = Join-Path $SuiteDir 'compose.override.yml'

function Log($msg) { Write-Host "[$AppName] $msg" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Log 'Docker is not available; nothing to stop.'
  exit 0
}

if (-not (Test-Path $ComposeFile)) {
  Log "Compose file not found at $ComposeFile; nothing to stop."
  exit 0
}

$ComposeArgs = @('-f', $ComposeFile)
if (Test-Path $OverrideFile) { $ComposeArgs += @('-f', $OverrideFile) }

Log 'Stopping docker compose stack'
Push-Location $SuiteDir
try {
  docker compose @ComposeArgs down --remove-orphans
}
finally {
  Pop-Location
}