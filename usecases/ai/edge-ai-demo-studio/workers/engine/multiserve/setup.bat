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

set "LLAMA_VULKAN_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/b7492/llama-b7492-bin-win-vulkan-x64.zip"
set "LLAMA_VULKAN_DOWNLOAD_FILE=llama-vulkan.zip"
set "LLAMA_VULKAN_EXTRACT_DIR=engine\llama.cpp-vulkan"

set "LLAMA_SYCL_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/b7492/llama-b7492-bin-win-sycl-x64.zip"
set "LLAMA_SYCL_DOWNLOAD_FILE=llama-sycl.zip"
set "LLAMA_SYCL_EXTRACT_DIR=engine\llama.cpp-sycl"

set "GGUF_PARSER_RELEASE_URL=https://github.com/gpustack/gguf-parser-go/releases/download/v0.22.1/gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_DOWNLOAD_FILE=gguf-parser-windows-amd64.exe"
set "GGUF_PARSER_EXTRACT_DIR=engine"

set "XPU_SMI_RELEASE_URL=https://github.com/intel/xpumanager/releases/download/V1.3.5/xpu-smi-1.3.5-20251216.170318.605ff78d_win.zip"
set "XPU_SMI_DOWNLOAD_FILE=xpu-win.zip"
set "XPU_SMI_EXTRACT_DIR=engine\xpu-smi"

set "OVMS_RELEASE_VERSION=v2025.4.1"
set "OVMS_RELEASE_URL=https://github.com/openvinotoolkit/model_server/releases/download/%OVMS_RELEASE_VERSION%/ovms_windows_python_on.zip"
set "OVMS_DOWNLOAD_FILE=ovms.zip"
set "OVMS_EXTRACT_DIR=engine"
set "OPTIMUM_EXPORT_MODEL_DIR=%OVMS_EXTRACT_DIR%/optimum_export_model"
set "OPTIMUM_EXPORT_MODEL_URL=https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/%OVMS_RELEASE_VERSION%/demos/common/export_models"
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
        goto :eof
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
    "Invoke-WebRequest -Uri '%LLAMA_VULKAN_RELEASE_URL%' -OutFile '%LLAMA_VULKAN_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
echo Download complete.

echo Extracting to %LLAMA_VULKANEXTRACT_DIR%...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%LLAMA_VULKAN_DOWNLOAD_FILE%' -DestinationPath '%LLAMA_VULKAN_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    goto :eof
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
    "Invoke-WebRequest -Uri '%LLAMA_SYCL_RELEASE_URL%' -OutFile '%LLAMA_SYCL_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
echo Download complete.

echo Extracting to %LLAMA_SYCL_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%LLAMA_SYCL_DOWNLOAD_FILE%' -DestinationPath '%LLAMA_SYCL_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    goto :eof
)
echo Extraction complete.
del "%LLAMA_SYCL_DOWNLOAD_FILE%"

:SKIP_LLAMA_SYCL_DOWNLOAD
echo.

:: --- 3. Download and Extract OVMS ---
echo ## 3. OVMS Download and Extraction
if exist "%OVMS_EXTRACT_DIR%\ovms" (
    echo **SUCCESS:** %OVMS_EXTRACT_DIR%\ovms already exists. Skipping download and extraction.
    goto :SKIP_OVMS_DOWNLOAD
)

echo Creating directory: %OVMS_EXTRACT_DIR%
md "%OVMS_EXTRACT_DIR%" 2>nul

echo Downloading %OVMS_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%OVMS_RELEASE_URL%' -OutFile '%OVMS_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
echo Download complete.

echo Extracting to %OVMS_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%OVMS_DOWNLOAD_FILE%' -DestinationPath '%OVMS_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    goto :eof
)
echo Extraction complete.
del "%OVMS_DOWNLOAD_FILE%"

echo Settingup optimum cli for OVMS...
call %OVMS_EXTRACT_DIR%\ovms\setupvars.bat

echo Installing OVMS Python requirements using bundled Python...
"%OVMS_EXTRACT_DIR%\ovms\python\python" -m pip install -r %OPTIMUM_EXPORT_MODEL_URL%/%OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL%
if errorlevel 1 (
    echo.
    echo **ERROR:** OVMS Python requirements installation failed. Aborting.
    goto :eof
)

:SKIP_OVMS_DOWNLOAD
echo.

:: --- 3.1 Download and Setup Optimum CLI---
echo ## 3.1 OVMS Download and Extraction
if exist "%OPTIMUM_EXPORT_MODEL_DIR%" (
    echo **SUCCESS:** %OPTIMUM_EXPORT_MODEL_DIR% already exists. Skipping download and extraction.
    goto :SKIP_OPTIMUM_EXPORT_MODEL_SETUP
)

set OPTIMUM_VENV_DIR="%OPTIMUM_EXPORT_MODEL_DIR%/.venv"
if exist "%OPTIMUM_VENV_DIR%" (
    echo **SUCCESS:** %OPTIMUM_VENV_DIR% already exists. Skipping download and extraction.
    goto :SKIP_OPTIMUM_EXPORT_MODEL_SETUP
)

echo Creating directory: %OPTIMUM_EXPORT_MODEL_DIR%
md "%OPTIMUM_EXPORT_MODEL_DIR%" 2>nul

echo Downloading Required Optimum CLI files...
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%OPTIMUM_EXPORT_MODEL_URL%/%OPTIMUM_EXPORT_MODEL_SCRIPT%' -OutFile '%OPTIMUM_EXPORT_MODEL_DIR%/%OPTIMUM_EXPORT_MODEL_SCRIPT%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%OPTIMUM_EXPORT_MODEL_URL%/%OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL%' -OutFile '%OPTIMUM_EXPORT_MODEL_DIR%/%OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)

echo Creating virtual environment in: %OPTIMUM_VENV_DIR%
"%UV_EXE%" venv "%OPTIMUM_VENV_DIR%"
if errorlevel 1 (
    echo.
    echo **ERROR:** Virtual environment creation failed. Aborting.
    goto :eof
)
echo Virtual environment created successfully.

call "%OPTIMUM_VENV_DIR%/Scripts/activate.bat"
if errorlevel 1 (
    echo.
    echo **ERROR:** Virtual environment activation failed. Aborting.
    goto :eof
)

echo Installing OVMS Optimum requirements into virtual environment...
"%UV_EXE%" pip install --pre --index-strategy unsafe-best-match -r "%OPTIMUM_EXPORT_MODEL_DIR%/%OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL%"
if errorlevel 1 (
    echo.
    echo **ERROR:** Package installation failed. Aborting.
    goto :eof
)

"%UV_EXE%" pip install datasets modelscope
if errorlevel 1 (
    echo.
    echo **ERROR:** Package installation failed. Aborting.
    goto :eof
)
call deactivate
echo Package installation completed successfully.

:SKIP_OPTIMUM_EXPORT_MODEL_SETUP

:: --- 4. Download and Extract GGUF Parser ---
echo ## 4. GGUF Parser Download
if exist "%GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE%" (
    echo **SUCCESS:** %GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE% already exists. Skipping download and extraction.
    goto :SKIP_GGUF_PARSER_DOWNLOAD
)

echo Downloading %GGUF_PARSER_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%GGUF_PARSER_RELEASE_URL%' -OutFile '%GGUF_PARSER_EXTRACT_DIR%\%GGUF_PARSER_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
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
    "Invoke-WebRequest -Uri '%XPU_SMI_RELEASE_URL%' -OutFile '%XPU_SMI_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
echo Download complete.

echo Extracting to %XPU_SMI_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%XPU_SMI_DOWNLOAD_FILE%' -DestinationPath '%XPU_SMI_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    goto :eof
)
echo Extraction complete.
del "%XPU_SMI_DOWNLOAD_FILE%"

:SKIP_XPU_DOWNLOAD
echo.

:: --- 3. Perform uv sync ---
echo ## 3. uv Sync
echo Running uv sync in the current project folder...
"%UV_EXE%" sync

if errorlevel 1 (
    echo.
    echo **ERROR:** uv sync failed. Check your project configuration.
    goto :eof
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