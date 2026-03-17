@ECHO off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

echo Installing Backend Service ...
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python is not installed. Please install Python 3.x and try again.
    exit /b 1
)

REM Create a virtual environment named 'backend-env'
if exist backend-env (
    echo Virtual environment already exists. Skipping creation ...
) ELSE (
    echo Creating virtual environment ...
    python -m venv backend-env
)

REM Activate the virtual environment
call backend-env\Scripts\activate

REM Install backend dependencies
python -m pip install fastapi[all] \
    sse_starlette==2.1.2 \
    scipy \
    soundfile \
    numpy==1.26.4 \
    openai==1.56.2 \
    pyyaml==6.0.1 \
    pypdf==6.7.5 \
    langchain==0.3.27 \
    langchain-chroma==0.2.5 \
    langchain-community===0.3.27 \
    chromadb==1.0.20 \
    'huggingface_hub>=0.23.0' \
    botocore==1.34.88 \
    cached_path==1.6.3 \
    python-magic

python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu \
    torch==2.9.1 \
    torchaudio==2.9.1 \
    openvino==2026.0 \
    optimum-intel[openvino,nncf]==1.27.0

pause
