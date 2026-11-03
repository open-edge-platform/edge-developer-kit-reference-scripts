@REM Copyright (C) 2026 Intel Corporation
@REM SPDX-License-Identifier: Apache-2.0

@echo off
setlocal EnableDelayedExpansion

:: Variables
set "UV_INSTALL_SCRIPT=https://astral.sh/uv/install.ps1"
if defined UV_PATH (
    set "UV_EXE=!UV_PATH!"
) else (
    set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
    where uv.exe >nul 2>nul
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%i in ('where uv.exe') do (
            set "UV_EXE=%%i"
            goto :uv_found
        )
    )
)
:uv_found
rem The engine uses the uv workspace's shared workers\.venv, not a venv of its own.
set "VENV_ACTIVATE_SCRIPT=..\..\.venv\Scripts\activate.bat"

set "LLAMA_VERSION=b11269"
set "LLAMA_VULKAN_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-vulkan-x64.zip"
set "LLAMA_VULKAN_DOWNLOAD_FILE=llama-vulkan.zip"
set "LLAMA_VULKAN_EXTRACT_DIR=engine\llama.cpp-vulkan"

set "LLAMA_SYCL_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-sycl-x64.zip"
set "LLAMA_SYCL_DOWNLOAD_FILE=llama-sycl.zip"
set "LLAMA_SYCL_EXTRACT_DIR=engine\llama.cpp-sycl"

set "GGUF_PARSER_RELEASE_URL=https://github.com/gpustack/gguf-parser-go/releases/download/v0.24.0/gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_DOWNLOAD_FILE=gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_EXTRACT_DIR=engine"

set "SHARED_OVMS_DIR=..\..\thirdparty\ovms"
rem workers\, for Initialize-Ovms in scripts\worker-common.ps1.
for %%I in ("%~dp0..\..") do set "MULTISERVE_WORKERS_ROOT=%%~fI"

set "UV_HTTP_TIMEOUT=180"

echo.
echo === Project Setup Script (Manual Activation Required) ===
echo.

:: uv
echo ## 1. uv Installation
if not exist "%UV_EXE%" (
    echo uv is NOT found. Attempting to install uv now...
    powershell -ExecutionPolicy ByPass -c "irm %UV_INSTALL_SCRIPT% | iex"
    
    if not exist "%UV_EXE%" (
        echo.
        echo **FATAL ERROR:** uv installation failed! File not found at: %UV_EXE%
        exit /b 1
    )
    echo uv installed successfully.
) else (
    echo uv is already installed. Skipping installation.
)
echo.

:: llama.cpp Vulkan
echo ## 2. Llama.cpp VULKAN Download and Extraction
if exist "%LLAMA_VULKAN_EXTRACT_DIR%" (
    echo **SUCCESS:** %LLAMA_VULKAN_EXTRACT_DIR% already exists. Skipping download and extraction.
    goto :SKIP_LLAMA_VULKAN_DOWNLOAD
)

echo Creating directory: %LLAMA_VULKAN_EXTRACT_DIR%
md "%LLAMA_VULKAN_EXTRACT_DIR%" 2>nul

echo Downloading %LLAMA_VULKAN_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%LLAMA_VULKAN_RELEASE_URL%' -OutFile '%LLAMA_VULKAN_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    exit /b 1
)
echo Download complete.

echo Extracting to %LLAMA_VULKAN_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%LLAMA_VULKAN_DOWNLOAD_FILE%' -DestinationPath '%LLAMA_VULKAN_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    exit /b 1
)
echo Extraction complete.
del "%LLAMA_VULKAN_DOWNLOAD_FILE%"

:SKIP_LLAMA_VULKAN_DOWNLOAD
echo.

:: llama.cpp SYCL
echo ## 2. Llama.cpp Download and Extraction
if exist "%LLAMA_SYCL_EXTRACT_DIR%" (
    echo **SUCCESS:** %LLAMA_SYCL_EXTRACT_DIR% already exists. Skipping download and extraction.
    goto :SKIP_LLAMA_SYCL_DOWNLOAD
)

echo Creating directory: %LLAMA_SYCL_EXTRACT_DIR%
md "%LLAMA_SYCL_EXTRACT_DIR%" 2>nul

echo Downloading %LLAMA_SYCL_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%LLAMA_SYCL_RELEASE_URL%' -OutFile '%LLAMA_SYCL_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    exit /b 1
)
echo Download complete.

echo Extracting to %LLAMA_SYCL_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%LLAMA_SYCL_DOWNLOAD_FILE%' -DestinationPath '%LLAMA_SYCL_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    exit /b 1
)
echo Extraction complete.
del "%LLAMA_SYCL_DOWNLOAD_FILE%"

:SKIP_LLAMA_SYCL_DOWNLOAD
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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$WorkersRoot = $env:MULTISERVE_WORKERS_ROOT; . (Join-Path $WorkersRoot 'scripts\worker-common.ps1'); Initialize-Ovms; exit 0"
if errorlevel 1 (
    echo.
    echo **ERROR:** Installing the OVMS model conversion tools failed. Aborting.
    exit /b 1
)
echo **SUCCESS:** OVMS model conversion tools are installed.

:: GGUF parser
echo ## 4. GGUF Parser Download
if exist "%GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE%" (
    echo **SUCCESS:** %GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE% already exists. Skipping download and extraction.
    goto :SKIP_GGUF_PARSER_DOWNLOAD
)

echo Downloading %GGUF_PARSER_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%GGUF_PARSER_RELEASE_URL%' -OutFile '%GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    exit /b 1
)
echo Download complete.

:SKIP_GGUF_PARSER_DOWNLOAD
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
