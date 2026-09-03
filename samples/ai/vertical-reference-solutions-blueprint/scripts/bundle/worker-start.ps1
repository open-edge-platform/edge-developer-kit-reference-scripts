# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Vertical Reference Solutions Blueprint as an Edge AI Studio worker (Windows).
#
# The studio's process handler runs this as
# `powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 --port <port>`
# with cwd = this directory, and treats the resulting process as the service:
# alive PID + HTTP 200 from /api/health => the service is "active"; stopping
# the service kills this process tree.
#
# The PowerShell counterpart of start.sh: prepare a writable data dir beside
# the read-only bundle, then hand over to the standalone Next server via
# bundle/server/kiosk.cjs.
$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Bundle = Join-Path $Here 'bundle'
$Data = Join-Path $Here 'data'
$StudioRoot = (Resolve-Path (Join-Path $Here '..\..')).Path

$Port = ''
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '--port') { $i++; $Port = if ($i -lt $args.Count) { $args[$i] } else { '' } }
}
if (-not $Port) { Write-Error 'public-service-kiosk: --port is required'; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $Bundle 'server'))) {
    Write-Error 'public-service-kiosk: bundle/server missing - was the bundle built?'; exit 1
}

# Writable half of the install; nothing here is ever overwritten (config.yaml
# is the operator's to edit, the database is the terminal's own).
New-Item -ItemType Directory -Force -Path (Join-Path $Data 'documents'), (Join-Path $Data 'face-photos') | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $Data 'config.yaml'))) {
    Copy-Item -LiteralPath (Join-Path $Bundle 'config.yaml') -Destination (Join-Path $Data 'config.yaml')
}
$seedDb = Join-Path $Bundle 'database\db.sqlite'
if (-not (Test-Path -LiteralPath (Join-Path $Data 'db.sqlite')) -and (Test-Path -LiteralPath $seedDb)) {
    Copy-Item -LiteralPath $seedDb -Destination (Join-Path $Data 'db.sqlite')
    $seedFaces = Join-Path $Bundle 'database\face-photos'
    if (Test-Path -LiteralPath $seedFaces) {
        Copy-Item -Path (Join-Path $seedFaces '*') -Destination (Join-Path $Data 'face-photos') -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Prefer the studio's bundled Node runtime, fall back to PATH.
$Node = Join-Path $StudioRoot 'thirdparty\node\node.exe'
if (-not (Test-Path -LiteralPath $Node)) { $Node = 'node' }

Set-Location -LiteralPath (Join-Path $Bundle 'server')
$env:NODE_ENV = 'production'
$env:PORT = $Port
$env:HOSTNAME = '127.0.0.1'
$env:KIOSK_DATA_DIR = $Data
$env:DATABASE_URL = "file:$(Join-Path $Data 'db.sqlite')"
$env:KIOSK_UPLOADS_DIR = Join-Path $Data 'documents'
$env:KIOSK_FACE_PHOTOS_DIR = Join-Path $Data 'face-photos'
& $Node kiosk.cjs
exit $LASTEXITCODE
