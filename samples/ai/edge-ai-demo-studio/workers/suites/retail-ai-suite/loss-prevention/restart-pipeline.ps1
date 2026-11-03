# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$AppName     = 'loss-prevention'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteDir    = Join-Path $ScriptDir 'src'
$ComposeFile = Join-Path $SuiteDir 'src\docker-compose.yml'

function Log($msg) { Write-Host "[$AppName] $msg" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Log 'Docker is not available.'
  exit 1
}

if (-not (Test-Path $ComposeFile)) {
  Log "docker-compose.yml not found at $ComposeFile - is the suite running?"
  exit 1
}

Log 'Restarting lp-pipeline-runner to reopen the display window'
Push-Location $SuiteDir
try {
  docker compose -f src/docker-compose.yml restart lp-pipeline-runner
  Log 'lp-pipeline-runner restarted - display window should reappear on the host display'
}
finally {
  Pop-Location
}
