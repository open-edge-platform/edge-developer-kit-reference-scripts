@echo off
REM Copyright (C) 2025 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

setlocal EnableDelayedExpansion

title AI Video Summarization Application

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo ================================================
echo AI Video Summarization Application
echo ================================================
echo.

:: Check if Python is installed
echo [1/8] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH!
    echo Attempting to install Python 3.12 using winget...
    winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% equ 0 (
        echo Python 3.12 installed successfully. Please restart this script.
        pause
        exit /b 0
    ) else (
        echo Failed to install Python automatically.
        echo Please install Python manually from https://python.org
    )
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Found Python %PYTHON_VERSION%
echo.

:: Check and install FFmpeg using winget
echo [2/8] Checking FFmpeg installation...
ffmpeg -version >nul 2>&1
if %errorlevel% neq 0 (
    echo FFmpeg not found. Installing FFmpeg using winget...
    winget install Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% equ 0 (
        echo FFmpeg installed successfully. You may need to restart your terminal.
    ) else (
        echo Failed to install FFmpeg automatically. Video conversion may not work properly.
    )
) else (
    echo FFmpeg is already installed.
)
echo.

:: Download sample videos
echo [3/8] Checking for sample video files...

:: Create assets directory if it doesn't exist
if not exist "assets" (
    mkdir "assets"
    echo Created assets directory
)

:: Download first sample video
if not exist "assets\traffic-intersection.mp4" (
    set "VIDEO_URL1=https://github.com/open-edge-platform/edge-ai-resources/raw/refs/heads/main/videos/1122south_h264.ts"
    set "DOWNLOAD_PATH1=assets\1122south_h264.ts"
    
    echo Downloading first sample video...
    powershell -Command "try { Invoke-WebRequest -Uri '!VIDEO_URL1!' -OutFile '!DOWNLOAD_PATH1!' -UseBasicParsing; exit 0 } catch { exit 1 }"
    if %errorlevel% equ 0 (
        echo First sample video downloaded successfully
        
        :: Convert first video if FFmpeg is available
        ffmpeg -version >nul 2>&1
        if %errorlevel% equ 0 (
            echo Converting and cutting first video from 4:31 to 6:31 to MP4 format...
            ffmpeg -i "assets\1122south_h264.ts" -ss 00:04:31 -t 00:02:00 -c copy "assets\traffic-intersection.mp4" -y
            if %errorlevel% equ 0 (
                echo First video converted and cut successfully to MP4
                del "assets\1122south_h264.ts"
                echo Cleaned up temporary TS file
            ) else (
                echo Failed to convert and cut first video
            )
        ) else (
            echo FFmpeg not available. Keeping TS file for manual conversion
        )
    ) else (
        echo Failed to download first sample video
        echo Please manually download from: !VIDEO_URL1!
    )
) else (
    echo First sample video already exists, skipping download
)

:: Download second sample video
if not exist "assets\store-aisle-detection.mp4" (
    set "VIDEO_URL2=https://github.com/intel-iot-devkit/sample-videos/raw/master/store-aisle-detection.mp4"
    set "DOWNLOAD_PATH2=assets\store-aisle-detection.mp4"
    
    echo Downloading second sample video...
    powershell -Command "try { Invoke-WebRequest -Uri '!VIDEO_URL2!' -OutFile '!DOWNLOAD_PATH2!' -UseBasicParsing; exit 0 } catch { exit 1 }"
    if %errorlevel% equ 0 (
        echo Second sample video downloaded successfully
    ) else (
        echo Failed to download second sample video
        echo Please manually download from: !VIDEO_URL2!
    )
) else (
    echo Second sample video already exists, skipping download
)

:: Download third sample video
if not exist "assets\worker-safety-gear.mp4" (
    set "VIDEO_URL3=https://github.com/intel-iot-devkit/safety-gear-detector-cpp/raw/master/resources/Safety_Full_Hat_and_Vest.mp4"
    set "DOWNLOAD_PATH3=assets\Safety_Full_Hat_and_Vest.mp4"
    
    echo Downloading third sample video...
    powershell -Command "try { Invoke-WebRequest -Uri '!VIDEO_URL3!' -OutFile '!DOWNLOAD_PATH3!' -UseBasicParsing; exit 0 } catch { exit 1 }"
    if %errorlevel% equ 0 (
        echo Third sample video downloaded successfully
        
        :: Rename to more descriptive filename
        if exist "!DOWNLOAD_PATH3!" (
            move "!DOWNLOAD_PATH3!" "assets\worker-safety-gear.mp4"
            echo Renamed video to worker-safety-gear.mp4
        )
    ) else (
        echo Failed to download third sample video
        echo Please manually download from: !VIDEO_URL3!
    )
) else (
    echo Third sample video already exists, skipping download
)

echo Sample videos are available.
echo.

:: Download Llamacpp binaries if not present
echo [4/8] Checking Llama-cpp binaries...
set "LLAMACPP_VERSION=b7223"

:: Check for Vulkan binaries
if not exist "llama-%LLAMACPP_VERSION%-bin-win-vulkan-x64\llama-server.exe" (
    echo Llama-cpp Vulkan binaries not found. Downloading...
    set "LLAMA_VULKAN_URL=https://github.com/ggml-org/llama.cpp/releases/download/!LLAMACPP_VERSION!/llama-!LLAMACPP_VERSION!-bin-win-vulkan-x64.zip"
    set "VULKAN_ZIP_PATH=llama-!LLAMACPP_VERSION!-bin-win-vulkan-x64.zip"
    powershell -Command "Invoke-WebRequest -Uri '!LLAMA_VULKAN_URL!' -OutFile '!VULKAN_ZIP_PATH!'"
    echo Extracting Llama-cpp Vulkan binaries...
    powershell -Command "Expand-Archive -Path '!VULKAN_ZIP_PATH!' -DestinationPath 'llama-!LLAMACPP_VERSION!-bin-win-vulkan-x64' -Force"
    del "!VULKAN_ZIP_PATH!"
)

echo Llama-cpp binaries are available.
echo.

:: Install uv if not present
echo [5/8] Checking uv installation...
where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing uv...
    winget install --id=astral-sh.uv -e --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install uv!
        pause
        exit /b 1
    )
    echo uv installed successfully. Refreshing PATH...
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
) else (
    echo uv is already installed.
)
echo.

:: Check if virtual environment exists, create if not
echo [5/8] Setting up virtual environment...
if not exist ".venv" (
    echo Creating virtual environment with uv...
    uv venv .venv
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create virtual environment!
        pause
        exit /b 1
    )
    echo Virtual environment created successfully.
) else (
    echo Virtual environment already exists.
)
echo.

:: Activate virtual environment
echo [6/8] Activating virtual environment...
call .venv\Scripts\activate.bat
if %errorlevel% neq 0 (
    echo ERROR: Failed to activate virtual environment!
    pause
    exit /b 1
)
echo Virtual environment activated.
echo.

:: Install/Update dependencies
echo [7/8] Installing dependencies...
echo This may take a few minutes on first run...
uv pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)
echo Dependencies installed successfully.
echo.

:: Start the application
echo [8/8] Starting AI Video Summarization Application...
echo.
echo ================================================
echo Starting model servers and web interface...
echo ================================================
echo.
echo Note: Please wait for the model servers to start.
echo.
echo The application will open in your web browser.
echo If it doesn't open automatically, go to: http://localhost:5999
echo.
echo To stop the application, close this window or press Ctrl+C
echo ================================================
echo.

:: Run the Python application
uv run app.py

:: Application has stopped
echo.
echo ================================================
echo Application has stopped.
echo ================================================
pause