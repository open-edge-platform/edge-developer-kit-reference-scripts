@REM Copyright (C) 2024 Intel Corporation
@REM SPDX-License-Identifier: Apache-2.0

@echo off
setlocal EnableDelayedExpansion

:: --- 1. Define Variables ---
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
set "VENV_ACTIVATE_SCRIPT=.venv\Scripts\activate.bat"

set "LLAMA_VERSION=b7992"
set "LLAMA_VULKAN_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-vulkan-x64.zip"
set "LLAMA_VULKAN_DOWNLOAD_FILE=llama-vulkan.zip"
set "LLAMA_VULKAN_EXTRACT_DIR=engine\llama.cpp-vulkan"

set "LLAMA_SYCL_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/%LLAMA_VERSION%/llama-%LLAMA_VERSION%-bin-win-sycl-x64.zip"
set "LLAMA_SYCL_DOWNLOAD_FILE=llama-sycl.zip"
set "LLAMA_SYCL_EXTRACT_DIR=engine\llama.cpp-sycl"

set "GGUF_PARSER_RELEASE_URL=https://github.com/gpustack/gguf-parser-go/releases/download/v0.24.0/gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_DOWNLOAD_FILE=gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_EXTRACT_DIR=engine"

set "XPU_SMI_RELEASE_URL=https://github.com/intel/xpumanager/releases/download/v1.3.6/xpu-smi-1.3.6-20260206.143316.1004f6cb_win.zip"
set "XPU_SMI_DOWNLOAD_FILE=xpu-win.zip"
set "XPU_SMI_EXTRACT_DIR=engine\xpu-smi"

set "SHARED_OVMS_DIR=..\..\thirdparty\ovms"

set "UV_HTTP_TIMEOUT=180"

set "OPTIMUM_EXPORT_MODEL_URL=https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/v2026.2/demos/common/export_models"
set "OPTIMUM_EXPORT_MODEL_SCRIPT=export_model.py"
set "OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL=requirements.txt"

echo.
echo === Project Setup Script (Manual Activation Required) ===
echo.

:: --- 1. Download and Install uv ---
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

:: --- 2. Download and Extract Llama.cpp VULKAN ---
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

:: --- 2.1 Download and Extract Llama.cpp SYCL ---
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

:: --- 3. Provision OVMS shared thirdparty ---
echo ## 3. OVMS Shared Thirdparty Setup
if not exist "%SHARED_OVMS_DIR%\ovms.exe" (
    echo.
    echo **ERROR:** Shared OVMS binary not found at %SHARED_OVMS_DIR%\ovms.exe
    echo Please run workers\setup.ps1 first to download the shared OVMS package.
    exit /b 1
)
echo **SUCCESS:** Shared OVMS found at %SHARED_OVMS_DIR%\ovms.exe

if exist "%SHARED_OVMS_DIR%\python\Lib\site-packages\optimum" (
    echo **SUCCESS:** Optimum already installed in OVMS bundled Python. Skipping.
    goto :SKIP_OVMS_PROVISION
)

echo Preparing OVMS Python package installation...
if defined PYTHONHOME (
    set "_PRE_OVMS_PYTHONHOME=%PYTHONHOME%"
)
if defined PYTHONPATH (
    set "_PRE_OVMS_PYTHONPATH=%PYTHONPATH%"
)
set "PYTHONHOME="
set "PYTHONPATH="

echo Installing OVMS Python requirements using bundled Python...
setlocal DisableDelayedExpansion
"%SHARED_OVMS_DIR%\python\python" -m pip install -r %OPTIMUM_EXPORT_MODEL_URL%/%OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL% "onnx!=1.21.0rc1" --pre
endlocal
if errorlevel 1 (
    echo.
    echo **ERROR:** OVMS Python requirements installation failed. Aborting.
    exit /b 1
)

"%SHARED_OVMS_DIR%\python\python" -m pip install datasets "pyarrow<21.0.0"
if errorlevel 1 (
    echo.
    echo **ERROR:** OVMS Python datasets installation failed. Aborting.
    exit /b 1
)

if defined _PRE_OVMS_PYTHONHOME (
    set "PYTHONHOME=%_PRE_OVMS_PYTHONHOME%"
    set "_PRE_OVMS_PYTHONHOME="
)
if defined _PRE_OVMS_PYTHONPATH (
    set "PYTHONPATH=%_PRE_OVMS_PYTHONPATH%"
    set "_PRE_OVMS_PYTHONPATH="
)

:SKIP_OVMS_PROVISION
:: --- 4. Download and Extract GGUF Parser ---
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

:: --- 5. Download and Extract XPU-SMI ---
echo ## 2. XPU-SMI Download and Extraction
if exist "%XPU_SMI_EXTRACT_DIR%" (
    echo **SUCCESS:** %XPU_SMI_EXTRACT_DIR% already exists. Skipping download and extraction.
    goto :SKIP_XPU_DOWNLOAD
)

echo Creating directory: %XPU_SMI_EXTRACT_DIR%
md "%XPU_SMI_EXTRACT_DIR%" 2>nul

echo Downloading %XPU_SMI_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%XPU_SMI_RELEASE_URL%' -OutFile '%XPU_SMI_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    exit /b 1
)
echo Download complete.

echo Extracting to %XPU_SMI_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%XPU_SMI_DOWNLOAD_FILE%' -DestinationPath '%XPU_SMI_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    exit /b 1
)
echo Extraction complete.
del "%XPU_SMI_DOWNLOAD_FILE%"

:SKIP_XPU_DOWNLOAD
echo.

:: --- 3. Perform uv sync ---
echo ## 3. uv Sync
if exist ".venv\pyvenv.cfg" (
    findstr /i /c:"ovms\\python" ".venv\pyvenv.cfg" >nul 2>nul
    if not errorlevel 1 (
        echo Found an incompatible virtual environment created from OVMS bundled Python.
        echo Removing .venv so uv can recreate it with a compatible interpreter...
        rmdir /s /q ".venv"
    )
)

set "PYTHONHOME="
set "PYTHONPATH="
echo Running uv sync in the current project folder...
"%UV_EXE%" sync

if errorlevel 1 (
    echo First uv sync attempt failed. Retrying once with UV_HTTP_TIMEOUT=%UV_HTTP_TIMEOUT%s...
    "%UV_EXE%" sync
)

if errorlevel 1 (
    echo.
    echo **ERROR:** uv sync failed. Check your project configuration.
    exit /b 1
)
echo uv sync completed successfully!
echo.

:: --- 4. Final Instructions ---
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
