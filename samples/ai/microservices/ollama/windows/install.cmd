@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

set EXTRA_INDEX_URL=https://pytorch-extension.intel.com/release-whl/stable/xpu/cn/

echo Installing Ollama using index URL: %EXTRA_INDEX_URL%
cd /d %~dp0

REM Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python is not installed. Please install Python 3.x and try again.
    exit /b 1
)

REM Create a virtual environment named 'ollama-env'
if exist ollama-env (
    echo Virtual environment already exists. Skipping creation ...
) ELSE (
    echo Creating virtual environment ...
    python -m venv ollama-env
)

REM Activate the virtual environment
call ollama-env\Scripts\activate

REM Upgrade pip and install required Python packages
python -m pip install --upgrade pip
python -m pip install --pre ipex_llm[cpp]==2.2.0b20250113 --extra-index-url %EXTRA_INDEX_URL%

REM Initialize Ollama
init-ollama

echo Ollama successfully installed!
pause
