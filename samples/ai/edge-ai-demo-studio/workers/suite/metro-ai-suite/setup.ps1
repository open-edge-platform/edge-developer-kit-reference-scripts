# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param([Parameter(Mandatory=$true)][string]$AppName)
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = Join-Path $ScriptDir $AppName
$SrcDir    = Join-Path $AppDir 'src'
$AppPath   = "metro-ai-suite/$AppName"
$AppConfig = Join-Path $AppDir 'suite.env'
$RefFile   = Join-Path $SrcDir '.demo-studio-edge-ai-suites-ref'

$RepoUrl    = if ($env:EDGE_AI_SUITES_REPO_URL) { $env:EDGE_AI_SUITES_REPO_URL } else { 'https://github.com/open-edge-platform/edge-ai-suites.git' }
$DefaultRef = if ($env:EDGE_AI_SUITES_DEFAULT_REF) { $env:EDGE_AI_SUITES_DEFAULT_REF } else { 'main' }

function Log($msg) { Write-Host "[metro-ai-suite/setup] $msg" }

function Get-NormalizedEnvKey([string]$Name) {
  return ($Name.ToUpperInvariant() -replace '[^A-Z0-9]', '_')
}

function Read-ConfigVar([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return $null }

  foreach ($line in Get-Content $File) {
    $trimmed = (($line -replace '#.*$', '').Trim())
    if (-not $trimmed) { continue }
    $parts = $trimmed.Split('=', 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Key) {
      return $parts[1].Trim()
    }
  }

  return $null
}

$AppEnvKey = "EDGE_AI_SUITES_$(Get-NormalizedEnvKey $AppName)_REF"
$AppEnvRef = [Environment]::GetEnvironmentVariable($AppEnvKey)
$ConfigRef = Read-ConfigVar $AppConfig 'EDGE_AI_SUITES_REF'
$RepoRef = if ($AppEnvRef) { $AppEnvRef } elseif ($env:EDGE_AI_SUITES_REF) { $env:EDGE_AI_SUITES_REF } elseif ($env:EDGE_AI_SUITES_BRANCH) { $env:EDGE_AI_SUITES_BRANCH } elseif ($ConfigRef) { $ConfigRef } else { $DefaultRef }

if (Test-Path (Join-Path $SrcDir 'compose.yml')) {
  if (Test-Path $RefFile) {
    $ExistingRef = (Get-Content $RefFile -Raw).Trim()
    if ($ExistingRef -ne $RepoRef) {
      Log "ERROR: $AppName is already set up from edge-ai-suites ref '$ExistingRef', but configuration requests '$RepoRef'."
      Log "Remove $SrcDir to fetch the configured ref, or restore EDGE_AI_SUITES_REF=$ExistingRef."
      exit 1
    }
  } else {
    Log "ERROR: $AppName already has a src checkout, but no recorded edge-ai-suites ref."
    Log "Remove $SrcDir to fetch '$RepoRef', or create $RefFile with the actual checked-out ref."
    exit 1
  }

  Log "$AppName already set up at $SrcDir (edge-ai-suites ref=$RepoRef)"
  exit 0
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  Log "Cloning $RepoUrl (sparse, ref=$RepoRef, path=$AppPath)"
  git clone --filter=blob:none --sparse --branch $RepoRef $RepoUrl $TempDir

  Push-Location $TempDir
  try { git sparse-checkout add $AppPath }
  finally { Pop-Location }

  $SourcePath = Join-Path $TempDir $AppPath
  if (-not (Test-Path $SourcePath)) {
    Log "ERROR: $AppPath not found in repo after sparse-checkout. Verify the app name is correct."
    exit 1
  }

  New-Item -ItemType Directory -Force -Path $SrcDir | Out-Null
  Copy-Item -Path "$SourcePath\*" -Destination $SrcDir -Recurse -Force
  Set-Content -Path $RefFile -Value $RepoRef

  Log "Setup complete: $SrcDir (edge-ai-suites ref=$RepoRef)"
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

param([Parameter(Mandatory=$true)][string]$AppName)
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = Join-Path $ScriptDir $AppName
$SrcDir    = Join-Path $AppDir 'src'
$AppPath   = "metro-ai-suite/$AppName"
$AppConfig = Join-Path $AppDir 'suite.env'
$RefFile   = Join-Path $SrcDir '.demo-studio-edge-ai-suites-ref'

$RepoUrl    = if ($env:EDGE_AI_SUITES_REPO_URL) { $env:EDGE_AI_SUITES_REPO_URL } else { 'https://github.com/open-edge-platform/edge-ai-suites.git' }
$DefaultRef = if ($env:EDGE_AI_SUITES_DEFAULT_REF) { $env:EDGE_AI_SUITES_DEFAULT_REF } else { 'main' }

function Log($msg) { Write-Host "[metro-ai-suite/setup] $msg" }

function Get-NormalizedEnvKey([string]$Name) {
  return ($Name.ToUpperInvariant() -replace '[^A-Z0-9]', '_')
}

function Read-ConfigVar([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return $null }

  foreach ($line in Get-Content $File) {
    $trimmed = (($line -replace '#.*$', '').Trim())
    if (-not $trimmed) { continue }
    $parts = $trimmed.Split('=', 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Key) {
      return $parts[1].Trim()
    }
  }

  return $null
}

$AppEnvKey = "EDGE_AI_SUITES_$(Get-NormalizedEnvKey $AppName)_REF"
$AppEnvRef = [Environment]::GetEnvironmentVariable($AppEnvKey)
$ConfigRef = Read-ConfigVar $AppConfig 'EDGE_AI_SUITES_REF'
$RepoRef = if ($AppEnvRef) { $AppEnvRef } elseif ($env:EDGE_AI_SUITES_REF) { $env:EDGE_AI_SUITES_REF } elseif ($env:EDGE_AI_SUITES_BRANCH) { $env:EDGE_AI_SUITES_BRANCH } elseif ($ConfigRef) { $ConfigRef } else { $DefaultRef }

# Skip if already cloned
if (Test-Path (Join-Path $SrcDir 'compose.yml')) {
  if (Test-Path $RefFile) {
    $ExistingRef = (Get-Content $RefFile -Raw).Trim()
    if ($ExistingRef -ne $RepoRef) {
      Log "ERROR: $AppName is already set up from edge-ai-suites ref '$ExistingRef', but configuration requests '$RepoRef'."
      Log "Remove $SrcDir to fetch the configured ref, or restore EDGE_AI_SUITES_REF=$ExistingRef."
      exit 1
    }
  } else {
    New-Item -ItemType Directory -Force -Path $SrcDir | Out-Null
    Set-Content -Path $RefFile -Value $RepoRef
  }

  Log "$AppName already set up at $SrcDir (edge-ai-suites ref=$RepoRef)"
  exit 0
}

# Sparse-clone the specific app path into a temp dir, then copy to the app folder
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  Log "Cloning $RepoUrl (sparse, ref=$RepoRef, path=$AppPath)"
  git clone --filter=blob:none --sparse --branch $RepoRef $RepoUrl $TempDir

  Push-Location $TempDir
  try { git sparse-checkout add $AppPath }
  finally { Pop-Location }

  $SourcePath = Join-Path $TempDir $AppPath
  if (-not (Test-Path $SourcePath)) {
    Log "ERROR: $AppPath not found in repo after sparse-checkout. Verify the app name is correct."
    exit 1
  }

  New-Item -ItemType Directory -Force -Path $SrcDir | Out-Null
  Copy-Item -Path "$SourcePath\*" -Destination $SrcDir -Recurse -Force
  Set-Content -Path $RefFile -Value $RepoRef

  Log "Setup complete: $SrcDir (edge-ai-suites ref=$RepoRef)"
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
