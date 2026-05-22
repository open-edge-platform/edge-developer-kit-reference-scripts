@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

set SERVING_HOST=localhost
set SERVING_PORT=8012
set MODEL_PATH="./data/model/llm"
set MODEL_PATH_OR_ID=llama3.2

if exist ollama.exe (
  echo Starting Ollama service ...
) else (
  echo ollama.exe not found. Please run install.cmd first before running!
  exit /b 1
)

if exist MODEL_PATH (
    echo Model available. Preparing to convert to Ollama format ...
) else (
    echo Model not available. Using default model: %MODEL_PATH_OR_ID% ...
)

call :start_ollama
call :validate_serving
call :pull_or_convert_model
call :preload_model

echo Ollama service running on http://%SERVING_HOST%:%SERVING_PORT%
pause >nul

:is_serving_running
curl -s -o NUL "http://%SERVING_HOST%:%SERVING_PORT%"
if %errorlevel%==0 (
    exit /b 0
) else (
    exit /b 1
)

:validate_serving
echo Verifying serving is running ...
call :is_serving_running
if %errorlevel%==0 (
    echo Serving service is ready!
) else (
    echo Serving service is not running. Retrying in 30 secs ...
    timeout /t 30 /nobreak >nul
    goto :validate_serving
)
goto :EOF

:start_ollama
REM Start Ollama service
set PATH=ollama-env\Library\bin;%PATH%
set OLLAMA_HOST=%SERVING_HOST%:%SERVING_PORT%
set OLLAMA_NUM_GPU=999
set OLLAMA_KEEP_ALIVE=-1
set no_proxy=localhost,127.0.0.1
set ZES_ENABLE_SYSMAN=1
set SYCL_CACHE_PERSISTENT=1
set SYCL_PI_LEVEL_ZERO_USE_IMMEDIATE_COMMANDLISTS=1

start "" /B ollama.exe serve
goto :EOF

:pull_or_convert_model
if defined MODEL_PATH_OR_ID (
    ollama.exe pull %MODEL_PATH_OR_ID%
) else (
    echo Convert model not supported for now ...
)
goto :EOF

:preload_model
echo Preloading model ...
curl -X POST http://%SERVING_HOST%:%SERVING_PORT%/api/chat -d "{\"model\": \"%MODEL_PATH_OR_ID%\"}" > NUL 2>&1
goto :EOF
