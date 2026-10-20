@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

setlocal
set "KIOSK_DIR=%~dp0.."
call "%~dp0..\..\common\setup_win.bat" %*
exit /b %ERRORLEVEL%
