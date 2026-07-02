# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$WorkersDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$UvCmd = Join-Path $WorkersDir "thirdparty\uv\uv.exe"
if (-not (Test-Path $UvCmd)) { $UvCmd = "uv" }

$VlVendorDir = Join-Path $ScriptDir "models\paddleocr_vl\_vendor"
$VlRepo = "https://github.com/openvinotoolkit/openvino_notebooks.git"
$VlCommit = "069417dfad03a787537588e7ce0be9cdb9acdb05"
$VlSubdir = "notebooks/paddleocr_vl"
$VlFiles = @("ov_paddleocr_vl.py", "image_processing_paddleocr_vl.py", "modeling_paddleocr_vl.py")

function Test-UV {
    if ((Test-Path $UvCmd) -or (Get-Command uv -ErrorAction SilentlyContinue)) { return }
    Write-Host "ERROR: uv not found." -ForegroundColor Red
    Write-Host "Please run the workers setup script first." -ForegroundColor Red
    exit 1
}

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
& $UvCmd sync
& $UvCmd pip install transformers==4.56.2
& $UvCmd run main.py @args
