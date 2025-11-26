@echo off
REM Copyright (C) 2025 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
REM Remove trailing backslash
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PORT=8080"

REM Define paths relative to the script directory
set "RESOURCES_DIR=%SCRIPT_DIR%\win-unpacked\resources"
set "FRONTEND_DIR=%RESOURCES_DIR%\frontend"
set "NODE_EXECUTABLE=%RESOURCES_DIR%\thirdparty\node\node.exe"
set "SERVER_JS=%FRONTEND_DIR%\server.js"

REM Check if the frontend directory exists
if not exist "%FRONTEND_DIR%" (
    echo Error: Frontend directory not found at %FRONTEND_DIR%
    exit /b 1
)

REM Check if node executable exists
if not exist "%NODE_EXECUTABLE%" (
    echo Error: Node.js executable not found at %NODE_EXECUTABLE%
    exit /b 1
)

REM Check if server.js exists
if not exist "%SERVER_JS%" (
    echo Error: server.js not found at %SERVER_JS%
    exit /b 1
)

REM Change to the frontend directory
cd /d "%FRONTEND_DIR%" || (
    echo Error: Failed to change to frontend directory
    exit /b 1
)

echo Starting web server...
echo Frontend directory: %FRONTEND_DIR%
echo Node executable: %NODE_EXECUTABLE%
echo Server script: %SERVER_JS%

REM Start the server using the specified node executable
"%NODE_EXECUTABLE%" server.js
