@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

echo Installing UI service ...
where node >nul 2>&1
if ERRORLEVEL 1 (
    ECHO Node.js not found. Please install nodejs by following the instruction in https://nodejs.org/en/download.
    pause
)

cd edge-ui
set NEXT_TELEMETRY_DISABLED=1

REM Installing UI dependencies ...
call npm install

REM Building UI service ...
echo Building UI ...
call npm run build

echo UI service successfully setup!

pause
