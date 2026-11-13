@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0
setlocal enabledelayedexpansion
if not defined BACKEND_SERVER_PORT set "BACKEND_SERVER_PORT=15000"
if not defined BLIP_SERVICE_PORT set "BLIP_SERVICE_PORT=15100"

:: ============================================================
:: Agentic Ultrasound Analyzer - Application Launcher
:: ============================================================
:: This script starts all required services and the application:
::   1. Milvus (Docker container)
::   2. OpenVINO Model Server (Windows service)
::   3. Flask backend (flask_backend_server.py)
::   4. Frontend (served by Flask in default browser)
:: ============================================================

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "LAUNCH_MODE=%~1"
set "QUICK_MODE=0"
if /I "%LAUNCH_MODE%"=="--quick" set "QUICK_MODE=1"

if "%QUICK_MODE%"=="1" (
    echo [MODE] Quick mode enabled - starts missing services with shorter waits.
)

if not exist "%ROOT_DIR%logs" mkdir "%ROOT_DIR%logs" >nul 2>&1
set "LOCK_FILE=%ROOT_DIR%logs\start_app.lock"

set "START_APP_INSTANCE_COUNT=0"
for /f %%C in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "@(Get-CimInstance Win32_Process ^| Where-Object { $_.Name -match '^cmd(\.exe)?$' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains('start_app.bat') }).Count"') do set "START_APP_INSTANCE_COUNT=%%C"

if exist "!LOCK_FILE!" (
    if "!START_APP_INSTANCE_COUNT!" GTR "1" (
        echo [ERROR] Another launcher instance appears to be running.
        echo         Existing lock file: !LOCK_FILE!
        echo         Use stop_app.bat --status to inspect running processes.
        pause
        exit /b 1
    )
    echo [WARN] Found stale launcher lock. Removing it.
    del /f /q "!LOCK_FILE!" >nul 2>&1
)

if "!START_APP_INSTANCE_COUNT!" GTR "1" (
    echo [ERROR] Another launcher instance appears to be running.
    echo         Use stop_app.bat --status to inspect running processes.
    pause
    exit /b 1
)

(
    echo STARTED_AT=%DATE% %TIME%
    echo MODE=%LAUNCH_MODE%
) > "!LOCK_FILE!"

:: ----------------------------------------------------------
:: 0. Process guard - clean stale processes before startup
:: ----------------------------------------------------------
echo [0/3] Cleaning stale service processes...
if exist "%ROOT_DIR%stop_app.bat" (
    call "%ROOT_DIR%stop_app.bat" --stale
    if !errorlevel! neq 0 (
        echo [WARN] Stale cleanup reported issues. Continuing startup.
    )
) else (
    echo [WARN] stop_app.bat not found. Skipping stale-process cleanup.
)
echo.

echo ============================================================
echo  Agentic Ultrasound Analyzer POC - Starting Application
echo ============================================================
echo.

:: ----------------------------------------------------------
:: 1. Ensure Docker is running, then start Milvus
:: ----------------------------------------------------------
echo [1/3] Checking Docker daemon...
set "DOCKER_DESKTOP_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_DESKTOP_EXE%" (
    echo [WARN] Docker Desktop is not installed. Please make sure that Milvus service is started using WSL.
    echo        Skipping Docker/Milvus startup.
    echo.
    goto skip_milvus
)
set "DOCKER_MAX_ATTEMPTS=120"
if "%QUICK_MODE%"=="1" set "DOCKER_MAX_ATTEMPTS=20"
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker_available
echo       Docker is not running. Attempting to start Docker Desktop...
start "" "%DOCKER_DESKTOP_EXE%"
echo       Waiting for Docker daemon to be ready...
set /a docker_attempts=0
:wait_docker
set /a docker_attempts+=1
if !docker_attempts! gtr !DOCKER_MAX_ATTEMPTS! (
    echo [ERROR] Docker did not start after !DOCKER_MAX_ATTEMPTS! attempts. Aborting.
    call :release_lock
    pause
    exit /b 1
)
timeout /t 2 >nul
docker info >nul 2>&1
if !errorlevel! neq 0 goto wait_docker
:docker_available
echo       Docker is available.

echo       Starting Milvus...
docker ps | findstr "milvus-standalone" | findstr /c:"(healthy)" >nul 2>&1
if %errorlevel% equ 0 (
    echo       Milvus is already running.
) else (
    set "MILVUS_HEALTH_MAX_ATTEMPTS=120"
    if "%QUICK_MODE%"=="1" set "MILVUS_HEALTH_MAX_ATTEMPTS=25"
    call "%ROOT_DIR%\milvus\standalone.bat" start
    if !errorlevel! neq 0 (
        echo [WARN] Milvus did not become healthy in time. Continuing without Milvus.
    ) else (
        echo       Milvus started successfully.
    )
)
echo.

:skip_milvus
:: ----------------------------------------------------------
:: 2. Activate venv and start Flask backend
:: ----------------------------------------------------------
echo [2/3] Starting Flask backend...

if "%QUICK_MODE%"=="1" (
    if not defined FLASK_STARTUP_TIMEOUT_SECONDS set "FLASK_STARTUP_TIMEOUT_SECONDS=90"
) else (
    if not defined FLASK_STARTUP_TIMEOUT_SECONDS set "FLASK_STARTUP_TIMEOUT_SECONDS=300"
)
if not defined MILVUS_ENABLE_ON_STARTUP set "MILVUS_ENABLE_ON_STARTUP=1"
if not defined BLIP_ENABLE_ON_STARTUP set "BLIP_ENABLE_ON_STARTUP=1"
set "BACKEND_LOG=%ROOT_DIR%logs\flask_backend_startup.log"
if exist "!BACKEND_LOG!" del /f /q "!BACKEND_LOG!" >nul 2>&1

:: Auto-detect Python virtual environment in the project folder
set "VENV_DIR=..\venv"
for /d %%D in ("%ROOT_DIR%*") do (
    if exist "%%D\pyvenv.cfg" if exist "%%D\Scripts\activate.bat" (
        set "VENV_DIR=%%D"
    )        
)
if not exist "!VENV_DIR!\Scripts\activate.bat" (
    echo [ERROR] No Python virtual environment found in %ROOT_DIR%
    echo        Create one first:  python -m venv ^<venv_name^>
    echo        Then install deps: pip install -r requirements.txt
    call :release_lock
    pause
    exit /b 1
)
for %%F in ("!VENV_DIR!") do set "VENV_NAME=%%~nxF"
echo       Found virtual environment: !VENV_NAME!
echo       Backend startup log: !BACKEND_LOG!

start "Flask Backend" cmd /k "cd /d "%ROOT_DIR%" && set "ASR_STREAMING_WARMUP=1" && set "ASR_PRECREATE_ON_STARTUP=1" && set "MILVUS_ENABLE_ON_STARTUP=1" && set "BLIP_ENABLE_ON_STARTUP=1" && set "FETALCLIP_PRELOAD_ON_STARTUP=1" && set "FETALCLIP_DEVICE=NPU" && set "OVMS_LOCAL_FALLBACK=1" && set "REPORT_PRELOAD_ON_STARTUP=1" && set "ULTRASOUND_PRELOAD_ON_STARTUP=1" && set PYTHONUTF8=1 && set PYTHONIOENCODING=utf-8 && call "!VENV_DIR!\Scripts\activate.bat" && python -X utf8 -u flask_backend_server.py 1>>"!BACKEND_LOG!" "
echo       Flask backend starting in a new window...
echo       Waiting for server health endpoint to be ready...

:: Wait up to FLASK_STARTUP_TIMEOUT_SECONDS for Flask to become available
set /a attempts=0
:wait_flask
set /a attempts+=1
if %attempts% gtr !FLASK_STARTUP_TIMEOUT_SECONDS! (
    goto flask_timeout
)
timeout /t 1 >nul
curl.exe --noproxy 127.0.0.1 -s -o nul -w "%%{http_code}" http://127.0.0.1:!BACKEND_SERVER_PORT!/health 2>nul | findstr "200" >nul 2>&1
if !errorlevel! neq 0 goto wait_flask
echo       Flask backend is ready (/health = 200).
echo.
goto open_browser

:flask_timeout
echo [ERROR] Flask health endpoint did not respond within !FLASK_STARTUP_TIMEOUT_SECONDS! seconds.
echo         Showing last backend startup log lines:
if exist "!BACKEND_LOG!" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path '!BACKEND_LOG!' -Tail 80"
    echo.
    echo         Most recent error-like log line:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=Select-String -Path '!BACKEND_LOG!' -Pattern 'Traceback|PortAudioError|Address already in use|ModuleNotFoundError|ImportError|Exception|ERROR' | Select-Object -Last 1; if($m){ $m.Line } else { 'No explicit error marker found in log tail.' }"
) else (
    echo         Backend log not found: !BACKEND_LOG!
)
echo.
echo         Current listener state (!BACKEND_SERVER_PORT!):
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort $env:BACKEND_SERVER_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess"
echo         Tip: increase timeout by setting FLASK_STARTUP_TIMEOUT_SECONDS before running this script.
call :release_lock
pause
exit /b 1

:: ----------------------------------------------------------
:: 3. Open frontend in default browser
:: ----------------------------------------------------------
:open_browser
echo [3/3] Opening frontend in browser...
start "" "http://127.0.0.1:!BACKEND_SERVER_PORT!/video_player_intent.html"
echo       Frontend opened.
echo.

echo ============================================================
echo  Application is running!
echo  - Flask backend: http://127.0.0.1:!BACKEND_SERVER_PORT!
echo  - Milvus:        localhost:19530
echo  - Press any key in this launcher to stop Flask/BLIP and Milvus.
echo ============================================================
echo.
pause

echo Shutting down services started by launcher...
if exist "%ROOT_DIR%stop_app.bat" (
    call "%ROOT_DIR%stop_app.bat" --shutdown
) else (
    echo [WARN] stop_app.bat not found. Manual shutdown may be required.
)

echo.
echo Launcher exit complete.
call :release_lock
exit /b 0

:release_lock
if defined LOCK_FILE (
    if exist "!LOCK_FILE!" del /f /q "!LOCK_FILE!" >nul 2>&1
)
exit /b 0