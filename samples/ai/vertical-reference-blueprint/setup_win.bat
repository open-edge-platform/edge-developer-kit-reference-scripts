@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

REM Windows entry point - runs the PowerShell script with the execution policy
REM relaxed for this process only, so an unsigned checkout runs without
REM changing the machine policy.

where pwsh.exe >nul 2>nul
if errorlevel 1 (set "PS_EXE=powershell.exe") else (set "PS_EXE=pwsh.exe")
%PS_EXE% -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\win\setup.ps1" %*
exit /b %ERRORLEVEL%
