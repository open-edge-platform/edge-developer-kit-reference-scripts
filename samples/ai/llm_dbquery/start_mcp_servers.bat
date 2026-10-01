@echo off
REM Copyright (C) 2025 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0

set "ROOT=%~dp0"
set "MODE=%~1"
if /I "%MODE%"=="__run_server" goto :run_server

set "ODBC_DOMAIN=%~1"

if not defined ODBC_DOMAIN if defined MCP_ODBCSERVER_DOMAIN set "ODBC_DOMAIN=%MCP_ODBCSERVER_DOMAIN%"

if /I not "%ODBC_DOMAIN%"=="manu" if /I not "%ODBC_DOMAIN%"=="retail" (
    echo Usage: %~nx0 ^<manu^|retail^>
    echo.
    echo The ODBC server requires a domain selection.
    echo Example: %~nx0 retail
    exit /b 1
)

call :validate_server "%ROOT%mcp_data_analysis_server" || exit /b 1
call :validate_server "%ROOT%mcp_odbcserver" || exit /b 1

call :launch_server "MCP Data Analysis Server" "%ROOT%mcp_data_analysis_server" "7909" ""
call :launch_server "MCP ODBC Server" "%ROOT%mcp_odbcserver" "7905" "--domain %ODBC_DOMAIN%"

exit /b 0

:validate_server
if not exist "%~1\server.py" (
    echo Missing server.py in %~1
    exit /b 1
)

if not exist "%~1\venv\Scripts\activate.bat" (
    echo Missing venv\Scripts\activate.bat in %~1
    exit /b 1
)

exit /b 0

:launch_server
set "WINDOW_TITLE=%~1"
set "SERVER_DIR=%~2"
set "SERVER_PORT=%~3"
set "SERVER_ARGS=%~4"

start "%WINDOW_TITLE%" cmd /k ""%~f0" __run_server "%SERVER_DIR%" "%SERVER_PORT%" %SERVER_ARGS%"

exit /b 0

:run_server
set "SERVER_DIR=%~2"
set "SERVER_PORT=%~3"

cd /d "%SERVER_DIR%"

if defined VIRTUAL_ENV if exist "%VIRTUAL_ENV%\Scripts\deactivate.bat" call "%VIRTUAL_ENV%\Scripts\deactivate.bat"

call venv\Scripts\activate.bat
python server.py start --port %SERVER_PORT% %~4 %~5 %~6 %~7 %~8 %~9

exit /b 0