# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

$AppName     = 'pallet-defect-detection'
$SampleApp   = 'pallet-defect-detection'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteRoot   = Resolve-Path (Join-Path $ScriptDir '..')
$SetupScript = Join-Path $SuiteRoot 'setup.ps1'
$SuiteDir    = Join-Path $ScriptDir 'src'
$ComposeFile = Join-Path $SuiteDir 'docker-compose.yml'
$EnvFile     = Join-Path $SuiteDir '.env'
$EnvTemplate = Join-Path $SuiteDir ".env_$SampleApp"
# Pristine upstream nginx config (read-only input — never modified in place).
$NginxConf   = Join-Path $SuiteDir "apps/$SampleApp/configs/nginx/nginx.conf"
# Patched nginx config kept OUTSIDE the cloned src/ tree and mounted into the
# nginx container via the compose override, so the upstream clone stays pristine.
$PatchedNginxConf = Join-Path $ScriptDir 'nginx.conf'
# Pristine upstream DL Streamer pipeline config + out-of-src patched (looped) copy.
$PsConfig         = Join-Path $SuiteDir "apps/$SampleApp/configs/pipeline-server-config.json"
$PatchedPsConfig  = Join-Path $ScriptDir 'pipeline-server-config.json'
$Sentinel    = Join-Path $SuiteDir ".demo-studio-$SampleApp-ready"
$OverrideDst = Join-Path $ScriptDir 'compose.override.yml'

function Log($msg) { Write-Host "[$AppName] $msg" }

function Detect-HostIp() {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = '127.0.0.1' }
  return $ip
}

function Upsert-EnvVar([string]$File, [string]$Key, [string]$Value) {
  $content = if (Test-Path $File) { Get-Content $File -Raw } else { '' }
  if ($content -match "(?m)^$Key=") {
    $updated = $content -replace "(?m)^$Key=.*$", "$Key=$Value"
    Set-Content -Path $File -Value $updated -NoNewline:$false
  } else {
    # Ensure the file ends with a newline before appending; some upstream
    # templates omit the trailing newline on their final line, which would
    # otherwise concatenate this key onto the previous entry.
    if ($content -and $content -notmatch "(`r`n|`n)$") {
      Add-Content -Path $File -Value "`n$Key=$Value"
    } else {
      Add-Content -Path $File -Value "$Key=$Value"
    }
  }
}

# Parse args
$HttpPort   = if ($env:PDD_HTTP_PORT)   { $env:PDD_HTTP_PORT }   else { '80' }
$HttpsPort  = if ($env:PDD_HTTPS_PORT)  { $env:PDD_HTTPS_PORT }  else { '443' }
$CoturnPort = if ($env:PDD_COTURN_PORT) { $env:PDD_COTURN_PORT } else { '3478' }
$MinioPort  = if ($env:PDD_MINIO_PORT)  { $env:PDD_MINIO_PORT }  else { '8000' }
$Device     = if ($env:PDD_DEVICE)      { $env:PDD_DEVICE }      else { 'CPU' }
# Loop the source video so the WebRTC demo runs continuously. Disable with
# --no-loop or PDD_LOOP=false.
$Loop       = if ($env:PDD_LOOP -eq 'false') { $false } else { $true }

for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    '--http-port'   { $HttpPort   = $args[$i+1]; $i++ }
    '--https-port'  { $HttpsPort  = $args[$i+1]; $i++ }
    '--coturn-port' { $CoturnPort = $args[$i+1]; $i++ }
    '--minio-port'  { $MinioPort  = $args[$i+1]; $i++ }
    '--device'      { $Device     = $args[$i+1]; $i++ }
    '--loop'        { $Loop       = $true }
    '--no-loop'     { $Loop       = $false }
  }
}

Log "Running suite setup ($SetupScript $AppName)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $SetupScript -AppName $AppName
if ($LASTEXITCODE -ne 0) { throw 'Suite setup failed' }

if (-not (Test-Path $ComposeFile)) { throw "docker-compose.yml not found at $ComposeFile" }
if (-not (Test-Path $EnvTemplate)) { throw ".env template not found at $EnvTemplate" }

$HostIp = if ($env:HOST_IP) { $env:HOST_IP } else { Detect-HostIp }
$MinioAccess = if ($env:MINIO_ACCESS_KEY) { $env:MINIO_ACCESS_KEY } else { 'intel1234' }
$MinioSecret = if ($env:MINIO_SECRET_KEY) { $env:MINIO_SECRET_KEY } else { 'intel1234' }
$MtxUser     = if ($env:MTX_WEBRTCICESERVERS2_0_USERNAME) { $env:MTX_WEBRTCICESERVERS2_0_USERNAME } else { 'intel1234' }
$MtxPass     = if ($env:MTX_WEBRTCICESERVERS2_0_PASSWORD) { $env:MTX_WEBRTCICESERVERS2_0_PASSWORD } else { 'intel1234' }

Log "Generating $EnvFile from template"
Copy-Item -Path $EnvTemplate -Destination $EnvFile -Force

Upsert-EnvVar $EnvFile 'HOST_IP'          $HostIp
Upsert-EnvVar $EnvFile 'MINIO_ACCESS_KEY' $MinioAccess
Upsert-EnvVar $EnvFile 'MINIO_SECRET_KEY' $MinioSecret
Upsert-EnvVar $EnvFile 'MTX_WEBRTCICESERVERS2_0_USERNAME' $MtxUser
Upsert-EnvVar $EnvFile 'MTX_WEBRTCICESERVERS2_0_PASSWORD' $MtxPass
Upsert-EnvVar $EnvFile 'NGINX_HTTP_PORT'    $HttpPort
Upsert-EnvVar $EnvFile 'NGINX_HTTPS_PORT'   $HttpsPort
Upsert-EnvVar $EnvFile 'COTURN_UDP_PORT'    $CoturnPort
Upsert-EnvVar $EnvFile 'MINIO_SERVER_PORT'  $MinioPort
Upsert-EnvVar $EnvFile 'SAMPLE_APP'         $SampleApp
Upsert-EnvVar $EnvFile 'APP_DIR'            (Join-Path $SuiteDir "apps/$SampleApp")

foreach ($v in 'http_proxy','https_proxy','no_proxy','HTTP_PROXY','HTTPS_PROXY','NO_PROXY') {
  $val = [Environment]::GetEnvironmentVariable($v)
  if ($val) { Upsert-EnvVar $EnvFile $v $val }
}

# Patch nginx.conf out-of-src: write a patched copy to $PatchedNginxConf and
# mount it via the compose override (below), keeping the cloned src/ pristine.
if (Test-Path $NginxConf) {
  Log "Writing patched nginx.conf with HTTP /nginx_healthz endpoint to $PatchedNginxConf"
  $nginx = Get-Content $NginxConf -Raw
  # Inject the exact-match /nginx_healthz location that returns 200 over HTTP.
  $healthBlock = @"
`$1listen 80;

`$1# Demo Studio polls this endpoint over HTTP before enabling the sample.
`$1location = /nginx_healthz {
`$1    return 200 "ok\n";
`$1    add_header Content-Type text/plain;
`$1}
"@
  $nginx = $nginx -replace '(?m)^(\s*)listen 80;', $healthBlock
  # Demote the server-scoped HTTPS redirect into a `location /` block; a
  # server-level `return 301` runs in the rewrite phase and would short-circuit
  # the health probe before location matching.
  $redirectBlock = @"
`$1# Demo Studio redirects remaining HTTP requests to HTTPS.
`$1location / {
`$1    return 301 https://`$host`$request_uri;
`$1}
"@
  $nginx = $nginx -replace '(?m)^(\s*)return 301 https://\$host\$request_uri;', $redirectBlock
  Set-Content -Path $PatchedNginxConf -Value $nginx -NoNewline:$false
} else {
  throw "Nginx config not found at $NginxConf"
}

# Select the pipeline (loop-aware). CPU looping uses the upstream-native
# `_mlops` pipeline (already multifilesrc loop=TRUE) — no injection. GPU/NPU
# have no looping counterpart upstream, so they keep their tuned names and get
# looping via config injection below.
$Pipeline = switch -Regex ($Device.ToLower()) {
  '^gpu' { 'pallet_defect_detection_gpu' }
  '^npu' { 'pallet_defect_detection_npu' }
  default { if ($Loop) { 'pallet_defect_detection_mlops' } else { 'pallet_defect_detection' } }
}

# Optionally patch the pipeline config out-of-src for looped playback on GPU/NPU.
# (CPU looping needs no patch — it uses the native _mlops pipeline.) Written
# outside src/ and mounted via the override, keeping the clone pristine.
if ($Loop -and $Pipeline -ne 'pallet_defect_detection_mlops') {
  if (-not (Test-Path $PsConfig)) { throw "pipeline-server-config.json not found at $PsConfig" }
  $payloadFile = Join-Path $SuiteDir "apps/$SampleApp/payload.json"
  $videoUri = ((Get-Content $payloadFile -Raw | ConvertFrom-Json) | ForEach-Object { $_.payload.source.uri } | Where-Object { $_ } | Select-Object -First 1)
  $videoPath = if ($videoUri) { $videoUri -replace '^file://', '' } else { '/home/pipeline-server/resources/videos/warehouse.avi' }
  Log "Enabling looped playback for '$Pipeline' (multifilesrc loop=TRUE, source=$videoPath) — patched config at $PatchedPsConfig"
  $cfg = Get-Content $PsConfig -Raw
  $cfg = $cfg.Replace('{auto_source} name=source ! decodebin3',
                      "multifilesrc loop=TRUE location=$videoPath name=source ! h264parse ! decodebin3")
  Set-Content -Path $PatchedPsConfig -Value $cfg -NoNewline:$false
} else {
  if (Test-Path $PatchedPsConfig) { Remove-Item $PatchedPsConfig -Force }
  if ($Loop) {
    Log "Looped playback via upstream-native '$Pipeline' pipeline (no config injection)"
  } else {
    Log "Looped playback disabled — using stock pipeline config"
  }
}

# Generate compose override: out-of-src nginx.conf mount (+ proxy env when set).
function Get-ProxyEnvLines([string]$indent) {
  $hp = [Environment]::GetEnvironmentVariable('http_proxy');  if (-not $hp) { $hp = [Environment]::GetEnvironmentVariable('HTTP_PROXY') }
  $sp = [Environment]::GetEnvironmentVariable('https_proxy'); if (-not $sp) { $sp = [Environment]::GetEnvironmentVariable('HTTPS_PROXY') }
  $np = [Environment]::GetEnvironmentVariable('no_proxy');    if (-not $np) { $np = [Environment]::GetEnvironmentVariable('NO_PROXY') }
  $lines = @()
  foreach ($pair in @(@('http_proxy', $hp), @('https_proxy', $sp), @('HTTP_PROXY', $hp), @('HTTPS_PROXY', $sp), @('no_proxy', $np), @('NO_PROXY', $np))) {
    $lines += "$indent- $($pair[0])=$($pair[1])"
  }
  return ($lines -join "`n")
}

$HasProxy = [bool]([Environment]::GetEnvironmentVariable('http_proxy') -or [Environment]::GetEnvironmentVariable('HTTP_PROXY') -or `
                   [Environment]::GetEnvironmentVariable('https_proxy') -or [Environment]::GetEnvironmentVariable('HTTPS_PROXY'))

Log "Generating compose override (proxy detected: $HasProxy)"
$ovr = @()
$ovr += '# Auto-generated by start.ps1 — do not edit manually.'
$ovr += 'services:'
$ovr += '  nginx:'
$ovr += '    volumes:'
$ovr += "      - `"$($PatchedNginxConf -replace '\\','/'):/etc/nginx/nginx.conf:ro`""
if ($HasProxy) {
  $ovr += '    environment:'
  $ovr += (Get-ProxyEnvLines '      ')
}
# dlstreamer-pipeline-server: looped config mount (when enabled) and/or proxy env.
if ((Test-Path $PatchedPsConfig) -or $HasProxy) {
  $ovr += '  dlstreamer-pipeline-server:'
  if (Test-Path $PatchedPsConfig) {
    $ovr += '    volumes:'
    $ovr += "      - `"$($PatchedPsConfig -replace '\\','/'):/home/pipeline-server/config.json`""
  }
  if ($HasProxy) {
    $ovr += '    environment:'
    $ovr += (Get-ProxyEnvLines '      ')
  }
}
if ($HasProxy) {
  foreach ($svc in 'mediamtx','coturn','mqtt-broker','minio','prometheus','otel-collector') {
    $ovr += "  $svc:"
    $ovr += '    environment:'
    $ovr += (Get-ProxyEnvLines '      ')
  }
}
Set-Content -Path $OverrideDst -Value ($ovr -join "`n") -NoNewline:$false

# Run upstream setup.sh (downloads model + video). Requires WSL/git-bash.
if (-not (Test-Path $Sentinel)) {
  Log "Running upstream setup.sh — downloads model + video for $SampleApp"
  $bash = (Get-Command bash -ErrorAction SilentlyContinue)
  if (-not $bash) {
    throw 'bash is required for upstream setup.sh (install Git Bash or WSL).'
  }
  Push-Location $SuiteDir
  try { & bash ./setup.sh; if ($LASTEXITCODE -ne 0) { throw 'Upstream setup.sh failed' } }
  finally { Pop-Location }
  New-Item -ItemType File -Force -Path $Sentinel | Out-Null
}

# Compose args
$ComposeArgs = @('--env-file', $EnvFile, '-f', $ComposeFile)
if ((Test-Path $OverrideDst) -and (Get-Item $OverrideDst).Length -gt 0) {
  $ComposeArgs += @('-f', $OverrideDst)
}

Push-Location $SuiteDir
$running = docker compose @ComposeArgs ps -q 2>$null
Pop-Location
if ($running) {
  Log 'Stack is already running - bringing it down before restart'
  Push-Location $SuiteDir
  docker compose @ComposeArgs down
  Pop-Location
}

$cleanup = {
  Log "Received shutdown signal - running 'docker compose down'"
  Push-Location $SuiteDir
  try { docker compose @ComposeArgs down } catch {}
  finally { Pop-Location }
}
Register-EngineEvent PowerShell.Exiting -Action $cleanup | Out-Null

try {
  Log 'Starting docker compose stack (detached)'
  Push-Location $SuiteDir
  docker compose @ComposeArgs up -d

  $pipeline = $Pipeline
  Log "Launching DL Streamer pipeline '$pipeline' on device '$Device'"

  # We deliberately do NOT use the upstream sample_start.sh here. That script
  # builds its REST target from HOST_IP:NGINX_HTTPS_PORT, but HOST_IP must remain
  # the machine's routable LAN IP so WebRTC ICE works for remote browsers — and a
  # host cannot always reach its own published docker ports via that LAN IP.
  # Instead we POST the pipeline payload directly over loopback, which is always
  # reachable, while leaving HOST_IP untouched for WebRTC.
  $payloadFile = Join-Path $SuiteDir "apps/$SampleApp/payload.json"
  if (-not (Test-Path $payloadFile)) { throw "payload file not found at $payloadFile" }
  $payloadJson = Get-Content $payloadFile -Raw | ConvertFrom-Json
  $entry = $payloadJson | Where-Object { $_.pipeline -eq $pipeline } | Select-Object -First 1
  if ($entry) {
    $payloadObj = $entry.payload
  } else {
    # Looping pipelines like _mlops aren't listed in payload.json and bake the
    # source into the template — derive from the base payload minus its source.
    $base = $payloadJson | Where-Object { $_.pipeline -eq 'pallet_defect_detection' } | Select-Object -First 1
    if (-not $base) { throw "no payload for pipeline '$pipeline' in $payloadFile" }
    $payloadObj = $base.payload | Select-Object -Property * -ExcludeProperty source
  }
  $body = $payloadObj | ConvertTo-Json -Depth 20 -Compress
  $launchUrl = "https://localhost:${HttpsPort}/api/pipelines/user_defined_pipelines/${pipeline}"

  $maxAttempts = 12
  for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
      Invoke-RestMethod -Method Post -Uri $launchUrl -ContentType 'application/json' `
        -Body $body -SkipCertificateCheck -TimeoutSec 10 | Out-Null
      Log "Pipeline '$pipeline' started successfully"
      break
    } catch {
      if ($i -eq $maxAttempts) { throw "Failed to launch pipeline after $maxAttempts attempts: $_" }
      Log "Pipeline launch not ready (attempt $i/$maxAttempts) - retrying in 5s"
      Start-Sleep -Seconds 5
    }
  }

  Log "Stack is up - UI: https://${HostIp}:${HttpsPort}/  WebRTC stream: https://${HostIp}:${HttpsPort}/mediamtx/pdd/"

  docker compose @ComposeArgs logs -f
}
finally {
  & $cleanup
  Pop-Location -ErrorAction SilentlyContinue
}
