@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

SET APP_HOST=localhost
SET APP_PORT=8013
set NLTK_DATA="./data/nltk_data"
set TTS_DEVICE=CPU
set ALLOWED_CORS=["*"]

echo Running Text to Speech service ...

REM Activate virtual environment
if exist tts-env (
  echo Activating virtual environment ...
  call tts-env\Scripts\activate
) else (
  echo Virtual environment not found. Please run the install script first!
  exit /b 1
)

REM Start Text to Speech service
cd ..
python -m uvicorn main:app --host %APP_HOST% --port %APP_PORT%

pause