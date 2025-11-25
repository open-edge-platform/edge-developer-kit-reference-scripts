@REM Copyright (C) 2024 Intel Corporation
@REM SPDX-License-Identifier: Apache-2.0

@echo off
setlocal EnableDelayedExpansion

:: --- 1. Define Variables ---
set "UV_INSTALL_SCRIPT=https://astral.sh/uv/install.ps1"
set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
set "VENV_ACTIVATE_SCRIPT=.venv\Scripts\activate.bat"

set "LLAMA_RELEASE_URL=https://github.com/ggerganov/llama.cpp/releases/download/b6945/llama-b6945-bin-win-vulkan-x64.zip"
set "LLAMA_DOWNLOAD_FILE=llama-vulkan.zip"
set "LLAMA_EXTRACT_DIR=engine\llama.cpp"

set "OVMS_RELEASE_URL=https://github.com/openvinotoolkit/model_server/releases/download/v2025.3/ovms_windows_python_on.zip"
set "OVMS_DOWNLOAD_FILE=ovms.zip"
set "OVMS_EXTRACT_DIR=engine"

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

:: --- 2. Download and Extract Llama.cpp ---
echo ## 2. Llama.cpp Download and Extraction
if exist "%LLAMA_EXTRACT_DIR%" (
    echo **SUCCESS:** %LLAMA_EXTRACT_DIR% already exists. Skipping download and extraction.
    goto :SKIP_LLAMA_DOWNLOAD
)

echo Creating directory: %LLAMA_EXTRACT_DIR%
md "%LLAMA_EXTRACT_DIR%" 2>nul

echo Downloading %LLAMA_DOWNLOAD_FILE%...
powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%LLAMA_RELEASE_URL%' -OutFile '%LLAMA_DOWNLOAD_FILE%'"
if errorlevel 1 (
    echo.
    echo **ERROR:** Download failed. Aborting.
    goto :eof
)
echo Download complete.

echo Extracting to %LLAMA_EXTRACT_DIR%...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%LLAMA_DOWNLOAD_FILE%' -DestinationPath '%LLAMA_EXTRACT_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo **ERROR:** Extraction failed. Aborting script.
    goto :eof
)
echo Extraction complete.
del "%LLAMA_DOWNLOAD_FILE%"

:SKIP_LLAMA_DOWNLOAD
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

:SKIP_OVMS_DOWNLOAD
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