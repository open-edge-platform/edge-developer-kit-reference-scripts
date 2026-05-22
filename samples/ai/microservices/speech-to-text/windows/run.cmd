@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

SET APP_HOST=localhost
SET APP_PORT=8014
set DEFAULT_MODEL_ID=openai/whisper-tiny
set STT_DEVICE=CPU
set ALLOWED_CORS=["*"]
set FFMPEG_PATH=./ffmpeg-bin

echo Running Speech To Text service on device: %STT_DEVICE% ...

REM Activate virtual environment
if exist stt-env (
  echo Activating virtual environment ...
  call stt-env\Scripts\activate
) else (
  echo Virtual environment not found. Please run the install script first!
  exit /b 1
)

REM Start Speech To Text service
cd ..
if exist %FFMPEG_PATH% (
  echo FFMEPG available
) else (
  echo FFMPEG not found in %FFMPEG_PATH%. Please download in https://github.com/BtbN/FFmpeg-Builds/releases and extract the content and copy the `bin` folder to `%FFMPEG_PATH%`
  pause
  exit
)
set PATH=%FFMPEG_PATH%;%PATH%
python -m uvicorn main:app --host %APP_HOST% --port %APP_PORT%

pause