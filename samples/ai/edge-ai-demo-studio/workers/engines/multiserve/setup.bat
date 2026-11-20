@REM Copyright (C) 2026 Intel Corporation
@REM SPDX-License-Identifier: Apache-2.0

@echo off
setlocal EnableDelayedExpansion

:: Variables
rem The uv workers\setup.ps1 installs, from a checked download; never a fetched install script.
if defined UV_PATH (
    set "UV_EXE=!UV_PATH!"
) else (
    set "UV_EXE=%~dp0..\..\thirdparty\uv\uv.exe"
)
rem The engine uses the uv workspace's shared workers\.venv, not a venv of its own.
set "VENV_ACTIVATE_SCRIPT=..\..\.venv\Scripts\activate.bat"

rem Checked downloads and install manifests: scripts\win\ in the repo, scripts\ in a packaged build.
set "INTEGRITY_SCRIPT=%~dp0..\..\..\scripts\win\thirdparty_integrity.ps1"
if not exist "%INTEGRITY_SCRIPT%" set "INTEGRITY_SCRIPT=%~dp0..\..\..\scripts\thirdparty_integrity.ps1"

rem pwsh when installed, as setup_win.bat picks: Windows PowerShell 5.1's Invoke-WebRequest ignores
rem HTTP_PROXY/HTTPS_PROXY, so behind a proxy given that way the downloads below would fail.
where pwsh.exe >nul 2>nul
if errorlevel 1 (set "PS_EXE=powershell.exe") else (set "PS_EXE=pwsh.exe")

rem Each download is checked against the SHA-256 beside its URL (GitHub's digest of the release
rem asset). Moving to another release means updating both.
rem EmbeddingGemma 2 needs b11540 or newer; b11696 (Vulkan and SYCL) was measured on a Core Ultra X7 358H.
set "LLAMA_VERSION=b11696"
set "LLAMA_VULKAN_RELEASE_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-vulkan-x64.zip"
set "LLAMA_VULKAN_SHA256=f62bbf1ce154911ce37a381b9b308893b064301ecb7512f30c7c2abf7f812e75"
set "LLAMA_VULKAN_EXTRACT_DIR=engine\llama.cpp-vulkan"

set "LLAMA_SYCL_RELEASE_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-sycl-x64.zip"
set "LLAMA_SYCL_SHA256=ccab197e6e6150721d34a48b95e49cd39c06aee04bf2b2559ac560ba666bae61"
set "LLAMA_SYCL_EXTRACT_DIR=engine\llama.cpp-sycl"

set "GGUF_PARSER_RELEASE_URL=https://github.com/gpustack/gguf-parser-go/releases/download/v0.24.0/gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_SHA256=e83243c53fbed2e98c5dd23c471310d2236f3524fcd2bc51530576f4c046b266"
set "GGUF_PARSER_PATH=engine\gguf-parser-windows-amd64.exe"

set "SHARED_OVMS_DIR=..\..\thirdparty\ovms"
rem workers\, for Initialize-Ovms in scripts\worker-common.ps1.
for %%I in ("%~dp0..\..") do set "MULTISERVE_WORKERS_ROOT=%%~fI"

set "UV_HTTP_TIMEOUT=180"

echo.
echo === Project Setup Script (Manual Activation Required) ===
echo.

:: uv
echo ## 1. uv
if not exist "%UV_EXE%" (
    echo.
    echo **ERROR:** uv not found at %UV_EXE%
    echo Please run workers\setup.ps1 first to download the shared uv.
    exit /b 1
)
echo **SUCCESS:** uv found at %UV_EXE%
echo.

if not exist "%INTEGRITY_SCRIPT%" (
    echo **ERROR:** thirdparty_integrity.ps1 not found next to the project's setup scripts.
    exit /b 1
)

:: llama.cpp Vulkan and SYCL: each replaced unless intact and from this release (see thirdparty_integrity.ps1).
:: The values reach PowerShell through the environment, which needs no quoting.
echo ## 2. Llama.cpp VULKAN Download and Extraction
%PS_EXE% -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; . $env:INTEGRITY_SCRIPT; $null = Install-VerifiedArchive -Label 'llama.cpp (Vulkan)' -Url $env:LLAMA_VULKAN_RELEASE_URL -Sha256 $env:LLAMA_VULKAN_SHA256 -Destination $env:LLAMA_VULKAN_EXTRACT_DIR"
if errorlevel 1 (
    echo.
    echo **ERROR:** Installing llama.cpp ^(Vulkan^) failed. Aborting.
    exit /b 1
)
echo.

echo ## 2. Llama.cpp SYCL Download and Extraction
%PS_EXE% -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; . $env:INTEGRITY_SCRIPT; $null = Install-VerifiedArchive -Label 'llama.cpp (SYCL)' -Url $env:LLAMA_SYCL_RELEASE_URL -Sha256 $env:LLAMA_SYCL_SHA256 -Destination $env:LLAMA_SYCL_EXTRACT_DIR"
if errorlevel 1 (
    echo.
    echo **ERROR:** Installing llama.cpp ^(SYCL^) failed. Aborting.
    exit /b 1
)
echo.

:: Shared OVMS and its model conversion tools
echo ## 3. OVMS Shared Thirdparty Setup
if not exist "%SHARED_OVMS_DIR%\ovms.exe" (
    echo.
    echo **ERROR:** Shared OVMS binary not found at %SHARED_OVMS_DIR%\ovms.exe
    echo Please run workers\setup.ps1 first to download the shared OVMS package.
    exit /b 1
)
echo **SUCCESS:** Shared OVMS found at %SHARED_OVMS_DIR%\ovms.exe

rem The same uv install the OVMS workers and start.ps1 run, so OVMS's bundled Python holds one
rem set of conversion packages. It only checks when workers\setup.ps1 already installed them.
%PS_EXE% -NoProfile -ExecutionPolicy Bypass -Command "$WorkersRoot = $env:MULTISERVE_WORKERS_ROOT; . (Join-Path $WorkersRoot 'scripts\worker-common.ps1'); Initialize-Ovms; exit 0"
if errorlevel 1 (
    echo.
    echo **ERROR:** Installing the OVMS model conversion tools failed. Aborting.
    exit /b 1
)
echo **SUCCESS:** OVMS model conversion tools are installed.

:: GGUF parser
echo ## 4. GGUF Parser Download
%PS_EXE% -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; . $env:INTEGRITY_SCRIPT; $null = Install-VerifiedFile -Label 'GGUF parser' -Url $env:GGUF_PARSER_RELEASE_URL -Sha256 $env:GGUF_PARSER_SHA256 -Destination $env:GGUF_PARSER_PATH"
if errorlevel 1 (
    echo.
    echo **ERROR:** Installing the GGUF parser failed. Aborting.
    exit /b 1
)
echo.

:: xpu-smi from an older setup: GPU memory is read from Windows' performance counters instead.
if exist "engine\xpu-smi" rmdir /s /q "engine\xpu-smi"

:: Final instructions
echo **All setup tasks completed successfully!**
echo.
echo ----------------------------------------------------------------------
echo **NEXT STEP:** The virtual environment is ready.
echo To **ACTIVATE** the environment in this terminal, type and press Enter:
echo.
echo %VENV_ACTIVATE_SCRIPT%
echo.
echo After activation, you can run: python app.py
echo ----------------------------------------------------------------------

endlocal
