# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

# SeedVR2 (presets.py, torch_xpu) runs numz's pipeline, which workers\upstream.json pins and
# this fetches into .\thirdparty\seedvr2 (cheap once there). The OpenVINO presets need nothing
# upstream, so they start without a network.
$Model = ""
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq "--model" -and ($i + 1) -lt $args.Count) {
        $Model = $args[$i + 1]
    } elseif ($args[$i] -match "^--model=(.+)$") {
        $Model = $Matches[1]
    }
}
if ($Model -like "seedvr2*") {
    Invoke-UpstreamFetch services/image-upscaling
}

Start-Worker @args
exit $LASTEXITCODE
