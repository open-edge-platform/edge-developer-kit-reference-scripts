@echo off
REM Copyright (C) 2024 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

SET UI_HOST=localhost
SET UI_PORT=8010
SET BACKEND_HOST=localhost
SET BACKEND_PORT=8011
SET SERVING_HOST=localhost
SET SERVING_PORT=8012

echo ######################
echo #    RAG Toolkit     #
echo ######################
call :validate_serving
call :start_backend
call :validate_backend
call :start_ui
call :validate_ui

echo Application is running on http://%UI_HOST%:%UI_PORT%
PAUSE >nul

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

:start_backend
echo Starting backend service ...
call .\backend-env\Scripts\activate.bat
cd .\backend
start "" /B uvicorn main:app --host "%BACKEND_HOST%" --port "%BACKEND_PORT%"
cd ..
goto :EOF

:is_backend_running
curl -s "http://%BACKEND_HOST%:%BACKEND_PORT%/healthcheck" | findstr /C:"OK" >NUL
if %ERRORLEVEL%==0 (
    exit /b 0
) else (
    exit /b 1
)

:validate_backend
echo Verifying backend is running ...
call :is_backend_running
if %errorlevel%==0 (
    echo Backend service is ready!
) else (
    echo Backend service is not running. Retrying in 30 secs ...
    timeout /t 30 /nobreak >nul
    goto :validate_backend
)
goto :EOF

:start_ui
echo Starting UI service ...
cd .\edge-ui
set NEXT_TELEMETRY_DISABLED=1
set PORT=%UI_PORT%
start "" /B npm run start 
goto :EOF

:is_ui_running
echo Verifying UI is running ...
curl -s -o NUL "http://%UI_HOST%:%UI_PORT%"
if %ERRORLEVEL%==0 (
    exit /b 0
) else (
    exit /b 1
)

:validate_ui
echo Verifying backend is running ...
call :is_ui_running
if %errorlevel%==0 (
    echo UI service is ready!
) else (
    echo UI service is not running. Retrying in 30 secs ...
    timeout /t 30 /nobreak >nul
    goto :validate_ui
)
goto :EOF
