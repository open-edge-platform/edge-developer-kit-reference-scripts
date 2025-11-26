@echo off
REM Copyright (C) 2025 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0\scripts\win\setup.ps1" %*
exit /b %ERRORLEVEL%