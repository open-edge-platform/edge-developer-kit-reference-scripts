@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

where pwsh.exe >nul 2>nul
if errorlevel 1 (set "PS_EXE=powershell.exe") else (set "PS_EXE=pwsh.exe")
%PS_EXE% -ExecutionPolicy Bypass -NoProfile -File "%~dp0\scripts\win\export.ps1" %*
exit /b %ERRORLEVEL%
