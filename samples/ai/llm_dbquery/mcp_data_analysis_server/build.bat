@echo off
REM Build script for Data_analysis_server MCP Server

echo Building Data_analysis_server MCP Server...

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not found in PATH.
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/upgrade dependencies
echo Installing dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt

REM Build the executable
echo Building executable...
python -m PyInstaller data_analysis_server_server.spec

if %errorlevel% equ 0 (
    echo Build successful!
    echo Executable created at: dist\data_analysis_server-mcp-server.exe
    
    REM Basic test
    echo Testing executable...
    dist\data_analysis_server-mcp-server.exe version --json
    
    if %errorlevel% equ 0 (
        echo Executable test passed!
    ) else (
        echo Warning: Executable test failed
    )
) else (
    echo Build failed!
    exit /b 1
)

echo Build process completed.
pause
