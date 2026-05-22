@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

echo Installing Text to Speech Service ...

REM Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python is not installed. Please install Python 3.x and try again.
    exit /b 1
)

REM Create a virtual environment named 'tts-env'
if exist tts-env (
    echo Virtual environment already exists. Skipping creation ...
) ELSE (
    echo Creating virtual environment ...
    python -m venv tts-env
)

REM Activate the virtual environment
call tts-env\Scripts\activate

REM Upgrade pip and install required Python packages
python -m pip install --upgrade pip
python -m pip install git+https://github.com/myshell-ai/MeloTTS.git
python -m pip install -r ../requirements.txt 
python -m unidic download

echo Text to Speech Service successfully installed!
pause