@echo off
REM Copyright (C) 2026 Intel Corporation
REM SPDX-License-Identifier: Apache-2.0
setlocal
:: Installs application dependencies using Python 3.12-3.14.

:: Use UTF-8 for Python CLI output, including redirected installation logs.
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "SCRIPT_DIR=%~dp0"
set "VENV_DIR_PATH=%SCRIPT_DIR%\venv"
set "REQUIREMENTS_FILE_PATH=%SCRIPT_DIR%\requirements.txt"
cd /d "%SCRIPT_DIR%"
if not exist "%SCRIPT_DIR%\scripts\logs" mkdir "%SCRIPT_DIR%\scripts\logs"
set "INSTALL_LOG_PATH=%SCRIPT_DIR%\scripts\logs\install_dependencies.log"
call :CheckCPUModel CPUName
echo CPU: %CPUName%
call :CheckPythonInstallation || goto :SetupFailed
call :InstallDependencies || goto :SetupFailed
exit /b %errorlevel%

:SetupFailed
echo.
echo [ERROR] Setup aborted.
exit /b 1

:CheckCPUModel
set "%~1=Unknown"
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_Processor).Name"') do set "%~1=%%i"
exit /b 0

:CheckPythonInstallation
python --version 1>NUL 2>NUL
if errorlevel 1 (
    echo [ERROR] Please make sure Python is installed and the installation path is added to the Path environment variable!
    exit /b 1
)
call :CheckPythonVersion python
exit /b %errorlevel%

:CheckPythonVersion
"%~1" -c "import sys; print('Python ' + '.'.join(map(str, sys.version_info[:3]))); sys.exit(0 if sys.version_info[:2] in ((3, 12), (3, 13), (3, 14)) else 1)"
if errorlevel 1 (
    echo [ERROR] Python 3.12, 3.13 or 3.14 is required. Interpreter: %~1
    exit /b 1
)
exit /b 0

:InstallDependencies
if exist "%VENV_DIR_PATH%" (
    if not exist "%VENV_DIR_PATH%\Scripts\python.exe" (
        echo [ERROR] The existing Python virtual environment has no Python interpreter.
        exit /b 1
    )
    call :CheckPythonVersion "%VENV_DIR_PATH%\Scripts\python.exe"
    if errorlevel 1 exit /b 1
	echo Python virtual environment already exists!
	exit /b 0
)
echo Creating a new Python virtual environment %VENV_DIR_PATH%
python -m venv "%VENV_DIR_PATH%"
if errorlevel 1 (
    echo [ERROR] Failed to create the Python virtual environment %VENV_DIR_PATH%
    rmdir /s /q "%VENV_DIR_PATH%"
    exit /b 1
)
echo Installing application dependencies... ^(log: %INSTALL_LOG_PATH%^)
call "%VENV_DIR_PATH%\Scripts\activate"
python -m pip install pip --upgrade > "%INSTALL_LOG_PATH%" 2>&1
pip install -r "%REQUIREMENTS_FILE_PATH%" >> "%INSTALL_LOG_PATH%" 2>&1
if errorlevel 1 goto :InstallDependenciesFailed
call "%VENV_DIR_PATH%\Scripts\deactivate"
echo Installation completed..!
exit /b 0

:InstallDependenciesFailed
call "%VENV_DIR_PATH%\Scripts\deactivate"
echo.
echo [ERROR] Failed to install Python dependencies from %REQUIREMENTS_FILE_PATH%
echo Last lines of %INSTALL_LOG_PATH%:
echo ------------------------------------------------------------
powershell -NoProfile -Command "Get-Content -Tail 20 -LiteralPath '%INSTALL_LOG_PATH%'"
echo ------------------------------------------------------------
:: Remove the incomplete venv so the next run retries instead of skipping
if exist "%VENV_DIR_PATH%" (
    rmdir /s /q "%VENV_DIR_PATH%"
)
echo Fix the error above (see the full log for details) and run this script again.
exit /b 1

call "%VENV_DIR_PATH%\Scripts\deactivate"
exit /b 0