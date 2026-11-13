@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0
setlocal

set "SCRIPT_DIR=%~dp0"

call :RemoveDirectory "%SCRIPT_DIR%venv" || exit /b 1
call :RemoveDirectory "%SCRIPT_DIR%scripts\models" || exit /b 1
exit /b 0

:RemoveDirectory
if not exist "%~1" (
    echo Not found, skipping: %~1
    exit /b 0
)

rmdir /s /q "%~1"
if errorlevel 1 (
    echo [ERROR] Failed to remove: %~1
    exit /b 1
)

echo Removed: %~1
exit /b 0