@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

call "%~dp0common\uninstall_win.bat" %*
exit /b %ERRORLEVEL%
