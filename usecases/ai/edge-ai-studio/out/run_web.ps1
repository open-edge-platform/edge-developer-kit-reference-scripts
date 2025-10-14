# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit immediately if a command fails
$ErrorActionPreference = "Stop"

# Get the directory where this script is located
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Set the port environment variable
$env:PORT = "8080"

# Define paths relative to the script directory
$RESOURCES_DIR = Join-Path $SCRIPT_DIR "edge-ai-studio-win32-x64\resources"
$FRONTEND_DIR = Join-Path $RESOURCES_DIR "frontend"
$NODE_EXECUTABLE = Join-Path $RESOURCES_DIR "thirdparty\node\node.exe"
$SERVER_JS = Join-Path $FRONTEND_DIR "server.js"

# Check if the frontend directory exists
if (-not (Test-Path $FRONTEND_DIR)) {
    Write-Host "Error: Frontend directory not found at $FRONTEND_DIR" -ForegroundColor Red
    exit 1
}

# Check if node executable exists
if (-not (Test-Path $NODE_EXECUTABLE)) {
    Write-Host "Error: Node.js executable not found at $NODE_EXECUTABLE" -ForegroundColor Red
    exit 1
}

# Check if server.js exists
if (-not (Test-Path $SERVER_JS)) {
    Write-Host "Error: server.js not found at $SERVER_JS" -ForegroundColor Red
    exit 1
}

# Change to the frontend directory
try {
    Push-Location $FRONTEND_DIR
} catch {
    Write-Host "Error: Failed to change to frontend directory" -ForegroundColor Red
    exit 1
}

Write-Host "Starting web server..." -ForegroundColor Green
Write-Host "Frontend directory: $FRONTEND_DIR" -ForegroundColor Cyan
Write-Host "Node executable: $NODE_EXECUTABLE" -ForegroundColor Cyan
Write-Host "Server script: $SERVER_JS" -ForegroundColor Cyan
Write-Host "Web interface will be available at: http://localhost:8080" -ForegroundColor Yellow

# Start the server using the specified node executable
& $NODE_EXECUTABLE "server.js"

Pop-Location
