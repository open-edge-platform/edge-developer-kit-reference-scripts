# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
function Log($msg) { Write-Host "[suite/setup] $msg" }

Get-ChildItem -Path $ScriptDir -Directory | ForEach-Object {
  $setupScript = Join-Path $_.FullName 'setup.ps1'
  if (Test-Path $setupScript) {
    Log "Found $($_.Name) (no-arg call)"
  }
}

Log 'All suite setup hooks discovered. Apps will be fetched lazily on first start.'
