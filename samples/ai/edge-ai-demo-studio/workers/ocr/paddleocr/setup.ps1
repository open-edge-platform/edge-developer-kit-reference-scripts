# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Provisions the PaddleOCR worker:
#   1. Clones the (uncommitted) PaddleOCR-VL helper files into
#      models\paddleocr_vl\_vendor.
#   2. Builds the venv with all dependencies (PP-OCR + PaddleOCR-VL) via
#      `uv sync`.
#
# start.ps1 runs `uv run` too, so this step is optional — it just makes the
# first start fast by pre-building the environment.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$WorkersDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$RootDir = (Resolve-Path (Join-Path $WorkersDir "..")).Path

# uv is vendored under workers\thirdparty. git is vendored under the
# project-root thirdparty on Windows.
$UvCmd = Join-Path $WorkersDir "thirdparty\uv\uv.exe"
if (-not (Test-Path $UvCmd)) {
    if (Get-Command uv -ErrorAction SilentlyContinue) { $UvCmd = "uv" }
    else { Write-Error "UV not found. Please run the workers setup first."; exit 1 }
}

function Resolve-Git {
    $candidates = @(
        (Join-Path $RootDir "thirdparty\git\cmd\git.exe"),
        (Join-Path $RootDir "thirdparty\git\bin\git.exe")
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return "git"
}
$GitCmd = Resolve-Git

# ── PaddleOCR-VL helper files (fetched at setup time, not committed) ──────────
$VlVendorDir = Join-Path $ScriptDir "models\paddleocr_vl\_vendor"
$VlRepo = "https://github.com/openvinotoolkit/openvino_notebooks.git"
$VlCommit = "069417dfad03a787537588e7ce0be9cdb9acdb05"
$VlSubdir = "notebooks/paddleocr_vl"
$VlFiles = @(
    "ov_paddleocr_vl.py",
    "image_processing_paddleocr_vl.py",
    "modeling_paddleocr_vl.py"
)

function Fetch-VlVendor {
    $present = $true
    foreach ($f in $VlFiles) {
        if (-not (Test-Path (Join-Path $VlVendorDir $f))) { $present = $false }
    }
    if ($present) {
        Write-Host "PaddleOCR-VL helper files already present, skipping fetch."
        return
    }
    if (-not (Get-Command $GitCmd -ErrorAction SilentlyContinue)) {
        Write-Error "git not found (looked in $RootDir\thirdparty\git and PATH)."
        exit 1
    }
    Write-Host "Fetching PaddleOCR-VL helper files @ $($VlCommit.Substring(0,10)) using $GitCmd ..."
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    & $GitCmd -C $tmp init -q
    & $GitCmd -C $tmp remote add origin $VlRepo
    & $GitCmd -C $tmp config core.sparseCheckout true
    Set-Content -Path (Join-Path $tmp ".git\info\sparse-checkout") -Value "$VlSubdir/"
    & $GitCmd -C $tmp fetch -q --depth 1 origin $VlCommit
    & $GitCmd -C $tmp checkout -q FETCH_HEAD
    New-Item -ItemType Directory -Force -Path $VlVendorDir | Out-Null
    foreach ($f in $VlFiles) {
        Copy-Item (Join-Path $tmp "$VlSubdir/$f") (Join-Path $VlVendorDir $f) -Force
    }
    Remove-Item -Recurse -Force $tmp
    Write-Host "Installed VL helper files to $VlVendorDir"
}

Write-Host "Setting up PaddleOCR worker..."
Write-Host "  uv  : $UvCmd"
Write-Host "  git : $GitCmd"

Fetch-VlVendor

Write-Host ""
Write-Host "PaddleOCR worker setup complete!"