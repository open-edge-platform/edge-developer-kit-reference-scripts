# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")
$WorkersDir = $WorkersRoot

$VlVendorDir = Join-Path $ScriptDir "models\paddleocr_vl\_vendor"
$VlRepo = "https://github.com/openvinotoolkit/openvino_notebooks.git"
$VlCommit = "069417dfad03a787537588e7ce0be9cdb9acdb05"
$VlSubdir = "notebooks/paddleocr_vl"
$VlFiles = @("ov_paddleocr_vl.py", "image_processing_paddleocr_vl.py", "modeling_paddleocr_vl.py")

function Invoke-FetchVlVendor {
    $allPresent = $VlFiles | ForEach-Object { Test-Path (Join-Path $VlVendorDir $_) } | Where-Object { -not $_ }
    if (-not $allPresent) {
        Write-Host "PaddleOCR-VL helper files already present, skipping fetch."
        return
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "Error: git not found." -ForegroundColor Red
        exit 1
    }
    Write-Host "Fetching PaddleOCR-VL helper files @ $($VlCommit.Substring(0,10))..."
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    git -C $tmp init -q
    git -C $tmp remote add origin $VlRepo
    git -C $tmp config core.sparseCheckout true
    Set-Content -Path (Join-Path $tmp ".git\info\sparse-checkout") -Value "$VlSubdir/"
    git -C $tmp fetch -q --depth 1 origin $VlCommit
    git -C $tmp checkout -q FETCH_HEAD
    New-Item -ItemType Directory -Path $VlVendorDir -Force | Out-Null
    foreach ($f in $VlFiles) {
        Copy-Item (Join-Path $tmp "$($VlSubdir.Replace('/','\\'))\\$f") (Join-Path $VlVendorDir $f)
    }
    Remove-Item $tmp -Recurse -Force
    Write-Host "Installed VL helper files to $VlVendorDir"
}

Test-UV
Invoke-FetchVlVendor
Set-Location $ScriptDir
# The shared start helper syncs this worker with --inexact, preserving other
# workers' packages in the shared environment.
Start-Worker @args
exit $LASTEXITCODE
