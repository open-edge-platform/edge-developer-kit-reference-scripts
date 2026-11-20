# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# verify_thirdparty.ps1 [-ProjectRoot <dir>] [-Full] -- check the third-party tools setup installed
# against their install manifests (thirdparty_integrity.ps1). Writes "<tool> (<path>): <problems>" for
# each one that is damaged, was changed or was never checked, and exits 1; exits 0 when all are intact.
# It compares sizes only, fast enough for every start (start.ps1, the Electron app); -Full compares
# SHA-256 as well, as setup does. A tool that is not installed is left to whatever needs it.

param(
    [string]$ProjectRoot,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'thirdparty_integrity.ps1')

# In the repo this file is in scripts\win\; in a packaged build, in scripts\.
if (-not $ProjectRoot) {
    $ProjectRoot = if ((Split-Path -Leaf $PSScriptRoot) -eq 'win') {
        Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    } else {
        Split-Path $PSScriptRoot -Parent
    }
}

$installs = [ordered]@{
    'Node.js'               = 'thirdparty\node'
    'Git'                   = 'thirdparty\git'
    'FFmpeg'                = 'thirdparty\ffmpeg'
    'uv'                    = 'workers\thirdparty\uv'
    'OpenVINO Model Server' = 'workers\thirdparty\ovms'
    'llama.cpp (Vulkan)'    = 'workers\engines\multiserve\engine\llama.cpp-vulkan'
    'llama.cpp (SYCL)'      = 'workers\engines\multiserve\engine\llama.cpp-sycl'
    'GGUF parser'           = 'workers\engines\multiserve\engine\gguf-parser-windows-amd64.exe'
}

$failed = $false
foreach ($tool in $installs.Keys) {
    $path = Join-Path $ProjectRoot $installs[$tool]
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $problems = @(Test-InstallManifest -Path $path -Quick:(-not $Full))
    if ($problems.Count -gt 0) {
        Write-Output "$tool ($path): $(Format-InstallProblems $problems)"
        $failed = $true
    }
}
if ($failed) { exit 1 }
exit 0
