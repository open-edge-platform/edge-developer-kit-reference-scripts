# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$AppName     = 'image-based-video-search'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteRoot   = Resolve-Path (Join-Path $ScriptDir '..')
$SetupScript = Join-Path $SuiteRoot 'setup.ps1'
$SuiteDir    = Join-Path $ScriptDir 'src'
$ModelsPath  = Join-Path $SuiteDir 'src/dlstreamer-pipeline-server/models'
$Sentinel    = Join-Path $SuiteDir '.demo-studio-models-ready'
$ComposeFile = Join-Path $SuiteDir 'compose.yml'

function Log($msg) { Write-Host "[$AppName] $msg" }

function Test-PortInUse([int]$Port) {
  $connections = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return ($connections | Where-Object { $_.Port -eq $Port }).Count -gt 0
}

function Check-Port([int]$Port, [string]$Label, [string]$VarName) {
  if (Test-PortInUse $Port) {
    Log "WARNING: Port $Port ($Label) is already in use."
    Log "  Set $VarName in src\.env to a free port, then restart."
    Log "  If you change the HTTP port, also update the service port in"
    Log "  the Demo Studio frontend (Admin -> Services -> Image-Based Video Search)."
    return $false
  }
  return $true
}

function Ensure-EnvVar([string]$File, [string]$Key, [string]$Value) {
  $content = if (Test-Path $File) { Get-Content $File -Raw } else { '' }
  if ($content -notmatch "(?m)^$Key=") {
    Add-Content -Path $File -Value "$Key=$Value"
  }
}

function Inject-EnvVar([string]$File, [string]$Key, [string]$Value) {
  $content = if (Test-Path $File) { Get-Content $File -Raw } else { '' }
  if ($content -match "(?m)^$Key=") {
    $updated = $content -replace "(?m)^$Key=.*$", "$Key=$Value"
    Set-Content -Path $File -Value $updated
  } else {
    Add-Content -Path $File -Value "$Key=$Value"
  }
}

function Read-EnvVar([string]$File, [string]$Key, [string]$Default) {
  if (Test-Path $File) {
    $line = Get-Content $File | Where-Object { $_ -match "^$Key=(.*)$" } | Select-Object -Last 1
    if ($line -match "^$Key=(.*)$") { return $Matches[1] }
  }
  return $Default
}

Log "Running suite setup ($SetupScript $AppName)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $SetupScript -AppName $AppName
if ($LASTEXITCODE -ne 0) { throw 'Suite setup failed' }

if (-not (Test-Path $Sentinel)) {
  Log 'Downloading ResNet-50 + YOLOv11s models - this can take several minutes on first run'
  New-Item -ItemType Directory -Force -Path $ModelsPath | Out-Null

  docker run --rm --user=root `
    -e http_proxy -e https_proxy -e no_proxy `
    -v "${ModelsPath}:/output" `
    openvino/ubuntu24_dev:2024.6.0 bash -c "omz_downloader --name resnet-50-pytorch --output_dir models && omz_converter --name resnet-50-pytorch --download_dir models --output_dir models && cp -r ./models/public/resnet-50-pytorch /output"

  docker run --rm --user=root `
    -e http_proxy -e https_proxy -e no_proxy `
    -v "${ModelsPath}:/output" `
    intel/dlstreamer:2026.0.0-ubuntu24 bash -c 'mkdir -p /output/public && export MODELS_PATH=/output && chmod +x /home/dlstreamer/dlstreamer/samples/download_public_models.sh && /home/dlstreamer/dlstreamer/samples/download_public_models.sh yolo11s coco128'

  New-Item -ItemType File -Force -Path $Sentinel | Out-Null
  Log 'Model setup complete'
} else {
  Log "Models already downloaded (sentinel: $Sentinel)"
}

$OverrideSrc = Join-Path $ScriptDir 'compose.override.yml'
$OverrideDst = Join-Path $SuiteDir 'compose.override.yml'
if (Test-Path $OverrideSrc) {
  $srcHash = (Get-FileHash $OverrideSrc -Algorithm MD5).Hash
  $dstHash = if (Test-Path $OverrideDst) { (Get-FileHash $OverrideDst -Algorithm MD5).Hash } else { '' }
  if ($srcHash -ne $dstHash) {
    Log 'Updating compose.override.yml in src/'
    Copy-Item $OverrideSrc $OverrideDst -Force
  }
}

$EnvFile = Join-Path $SuiteDir '.env'
Ensure-EnvVar $EnvFile 'IBVS_HTTP_PORT' '80'
Ensure-EnvVar $EnvFile 'IBVS_HTTPS_PORT' '443'
Ensure-EnvVar $EnvFile 'IBVS_RTSP_PORT' '8554'

Inject-EnvVar $EnvFile 'http_proxy'  $env:http_proxy
Inject-EnvVar $EnvFile 'https_proxy' $env:https_proxy
Inject-EnvVar $EnvFile 'no_proxy'    $env:no_proxy
Inject-EnvVar $EnvFile 'HTTP_PROXY'  $env:HTTP_PROXY
Inject-EnvVar $EnvFile 'HTTPS_PROXY' $env:HTTPS_PROXY
Inject-EnvVar $EnvFile 'NO_PROXY'    $env:NO_PROXY

$HttpPort  = if ($env:IBVS_HTTP_PORT)  { $env:IBVS_HTTP_PORT }  else { Read-EnvVar $EnvFile 'IBVS_HTTP_PORT'  '80' }
$HttpsPort = if ($env:IBVS_HTTPS_PORT) { $env:IBVS_HTTPS_PORT } else { Read-EnvVar $EnvFile 'IBVS_HTTPS_PORT' '443' }
$RtspPort  = if ($env:IBVS_RTSP_PORT)  { $env:IBVS_RTSP_PORT }  else { Read-EnvVar $EnvFile 'IBVS_RTSP_PORT'  '8554' }

$ComposeArgs = @('-f', $ComposeFile)
if (Test-Path $OverrideDst) { $ComposeArgs += @('-f', $OverrideDst) }

Push-Location $SuiteDir
$running = docker compose @ComposeArgs ps -q 2>$null
Pop-Location
if ($running) {
  Log 'Stack is already running - bringing it down before restart'
  Push-Location $SuiteDir
  docker compose @ComposeArgs down
  Pop-Location
}

$portOk = $true
if (-not (Check-Port $HttpPort 'nginx HTTP' 'IBVS_HTTP_PORT')) { $portOk = $false }
if (-not (Check-Port $HttpsPort 'nginx HTTPS' 'IBVS_HTTPS_PORT')) { $portOk = $false }
if (-not (Check-Port $RtspPort 'RTSP proxy' 'IBVS_RTSP_PORT')) { $portOk = $false }
if (-not $portOk) {
  Log 'One or more required ports are in use. See warnings above.'
  exit 1
}

$cleanup = {
  Log "Received shutdown signal - running 'docker compose down'"
  Push-Location $SuiteDir
  try { docker compose @ComposeArgs down } catch {}
  finally { Pop-Location }
}
Register-EngineEvent PowerShell.Exiting -Action $cleanup | Out-Null

try {
  Log 'Starting docker compose stack'
  Push-Location $SuiteDir
  docker compose @ComposeArgs up
}
finally {
  & $cleanup
  Pop-Location -ErrorAction SilentlyContinue
}