@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0
if not defined BLIP_SERVICE_PORT set "BLIP_SERVICE_PORT=15100"
echo Starting BLIP Embedding Microservice on port %BLIP_SERVICE_PORT%...
echo.
set "VENV_DIR_PATH=..\venv"
call "%VENV_DIR_PATH%\Scripts\activate"
python blip_service.py --port %BLIP_SERVICE_PORT% %*
