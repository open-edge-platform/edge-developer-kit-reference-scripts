# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

# AI Video Summarization App Launcher (PowerShell)
# Double-click this file to run the application

# Set window title
$Host.UI.RawUI.WindowTitle = "AI Video Summarization Application"

# Get script directory and change to it
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "AI Video Summarization Application" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

try {
    # Check if Python is installed
    Write-Host "[1/8] Checking Python installation..." -ForegroundColor Yellow
    $pythonVersion = python --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Python is not installed or not in PATH!" -ForegroundColor Red
        Write-Host "Attempting to install Python 3.12 using winget..." -ForegroundColor Yellow
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Python 3.12 installed successfully. Please restart this script." -ForegroundColor Green
            Read-Host "Press Enter to exit"
            exit 0
        } else {
            Write-Host "Failed to install Python automatically." -ForegroundColor Red
            Write-Host "Please install Python manually from https://python.org" -ForegroundColor Red
        }
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Found $pythonVersion" -ForegroundColor Green
    Write-Host ""

    # Check and install FFmpeg using winget
    Write-Host "[2/8] Checking FFmpeg installation..." -ForegroundColor Yellow
    $ffmpegInstalled = $false
    try {
        ffmpeg -version | Out-Null
        $ffmpegInstalled = $true
        Write-Host "FFmpeg is already installed." -ForegroundColor Green
    } catch {
        Write-Host "FFmpeg not found. Installing FFmpeg using winget..." -ForegroundColor Yellow
        winget install Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "FFmpeg installed successfully. You may need to restart your terminal." -ForegroundColor Green
            $ffmpegInstalled = $true
            # Refresh PATH environment variable
            $env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        } else {
            Write-Host "Failed to install FFmpeg automatically. Video conversion may not work properly." -ForegroundColor Yellow
        }
    }
    Write-Host ""

    # Download sample videos
    Write-Host "[3/8] Checking for sample video files..." -ForegroundColor Yellow
    
    # Function to download files using PowerShell
    function Download-File {
        param(
            [string]$Url,
            [string]$OutputPath
        )
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
            return $true
        } catch {
            Write-Host "Failed to download: $Url" -ForegroundColor Red
            return $false
        }
    }
    
    # Create assets directory if it doesn't exist
    if (-not (Test-Path "assets")) {
        New-Item -ItemType Directory -Path "assets" | Out-Null
        Write-Host "Created assets directory" -ForegroundColor Yellow
    }
    
    # Download first sample video
    if (-not (Test-Path "assets\traffic-intersection.mp4")) {
        $video_url1 = "https://github.com/open-edge-platform/edge-ai-resources/raw/refs/heads/main/videos/1122south_h264.ts"
        $download_path1 = "assets\1122south_h264.ts"
        
        Write-Host "Downloading first sample video..." -ForegroundColor Yellow
        if (Download-File $video_url1 $download_path1) {
            Write-Host "First sample video downloaded successfully" -ForegroundColor Green
            
            # Convert first video if FFmpeg is available
            if ($ffmpegInstalled) {
                Write-Host "Converting and cutting first video (4:31 to 6:31) to MP4 format..." -ForegroundColor Yellow
                try {
                    ffmpeg -i "assets\1122south_h264.ts" -ss 00:04:31 -t 00:02:00 -c copy "assets\traffic-intersection.mp4" -y
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "First video converted and cut successfully to MP4" -ForegroundColor Green
                        Remove-Item "assets\1122south_h264.ts" -Force
                        Write-Host "Cleaned up temporary TS file" -ForegroundColor Green
                    } else {
                        Write-Host "Failed to convert and cut first video" -ForegroundColor Red
                    }
                } catch {
                    Write-Host "Error during video conversion: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "FFmpeg not available. Keeping TS file for manual conversion" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Failed to download first sample video" -ForegroundColor Red
            Write-Host "Please manually download from: $video_url1" -ForegroundColor Yellow
        }
    } else {
        Write-Host "First sample video already exists, skipping download" -ForegroundColor Green
    }
    
    # Download second sample video
    if (-not (Test-Path "assets\store-aisle-detection.mp4")) {
        $video_url2 = "https://github.com/intel-iot-devkit/sample-videos/raw/master/store-aisle-detection.mp4"
        $download_path2 = "assets\store-aisle-detection.mp4"
        
        Write-Host "Downloading second sample video..." -ForegroundColor Yellow
        if (Download-File $video_url2 $download_path2) {
            Write-Host "Second sample video downloaded successfully" -ForegroundColor Green
        } else {
            Write-Host "Failed to download second sample video" -ForegroundColor Red
            Write-Host "Please manually download from: $video_url2" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Second sample video already exists, skipping download" -ForegroundColor Green
    }
    
    # Download third sample video
    if (-not (Test-Path "assets\worker-safety-gear.mp4")) {
        $video_url3 = "https://github.com/intel-iot-devkit/safety-gear-detector-cpp/raw/master/resources/Safety_Full_Hat_and_Vest.mp4"
        $download_path3 = "assets\Safety_Full_Hat_and_Vest.mp4"
        
        Write-Host "Downloading third sample video..." -ForegroundColor Yellow
        if (Download-File $video_url3 $download_path3) {
            Write-Host "Third sample video downloaded successfully" -ForegroundColor Green
            
            # Rename to more descriptive filename
            if (Test-Path $download_path3) {
                Move-Item $download_path3 "assets\worker-safety-gear.mp4" -Force
                Write-Host "Renamed video to worker-safety-gear.mp4" -ForegroundColor Green
            }
        } else {
            Write-Host "Failed to download third sample video" -ForegroundColor Red
            Write-Host "Please manually download from: $video_url3" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Third sample video already exists, skipping download" -ForegroundColor Green
    }
    
    Write-Host "Sample videos are available." -ForegroundColor Green
    Write-Host ""

    # Download Llamacpp binaries if not present
    Write-Host "[4/8] Checking Llama-cpp binaries..." -ForegroundColor Yellow
    $llamacppVersion = "b7223"
    # Check for Vulkan binaries
    $vulkanBinariesExist = Test-Path ".\llama-$llamacppVersion-bin-win-vulkan-x64\llama-server.exe"

    if (-not $vulkanBinariesExist) {
        Write-Host "Llama-cpp Vulkan binaries not found. Downloading..." -ForegroundColor Yellow
        $llamaVulkanUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$llamacppVersion/llama-$llamacppVersion-bin-win-vulkan-x64.zip"
        $vulkanZipPath = ".\llama-$llamacppVersion-bin-win-vulkan-x64.zip"
        Invoke-WebRequest -Uri $llamaVulkanUrl -OutFile $vulkanZipPath
        Write-Host "Extracting Llama-cpp Vulkan binaries..." -ForegroundColor Yellow
        Expand-Archive -Path $vulkanZipPath -DestinationPath ".\llama-$llamacppVersion-bin-win-vulkan-x64" -Force
        Remove-Item $vulkanZipPath
        Write-Host "Llama-cpp binaries downloaded and extracted successfully." -ForegroundColor Green
    } else {
        Write-Host "Llama-cpp binaries already present." -ForegroundColor Green
    }

    # Install uv if not present
    Write-Host "[5/8] Checking uv installation..." -ForegroundColor Yellow
    $uvInstalled = $false
    try {
        uv --version | Out-Null
        $uvInstalled = $true
        Write-Host "uv is already installed." -ForegroundColor Green
    } catch {
        Write-Host "Installing uv..." -ForegroundColor Yellow
        winget install --id=astral-sh.uv -e --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "uv installed successfully." -ForegroundColor Green
            $env:PATH = "$env:USERPROFILE\.local\bin;" + $env:PATH
            $uvInstalled = $true
        } else {
            throw "Failed to install uv!"
        }
    }
    Write-Host ""

    # Check if virtual environment exists, create if not
    Write-Host "[5/8] Setting up virtual environment..." -ForegroundColor Yellow
    if (-not (Test-Path ".venv")) {
        Write-Host "Creating virtual environment with uv..." -ForegroundColor Yellow
        uv venv .venv
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create virtual environment!"
        }
        Write-Host "Virtual environment created successfully." -ForegroundColor Green
    } else {
        Write-Host "Virtual environment already exists." -ForegroundColor Green
    }
    Write-Host ""

    # Activate virtual environment
    Write-Host "[6/8] Activating virtual environment..." -ForegroundColor Yellow
    & ".venv\Scripts\Activate.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to activate virtual environment!"
    }
    Write-Host "Virtual environment activated." -ForegroundColor Green
    Write-Host ""

    # Install/Update dependencies
    Write-Host "[7/8] Installing dependencies..." -ForegroundColor Yellow
    Write-Host "This may take a few minutes on first run..." -ForegroundColor Yellow
    uv pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install dependencies!"
    }
    Write-Host "Dependencies installed successfully." -ForegroundColor Green
    Write-Host ""

    # Start the application
    Write-Host "[8/8] Starting AI Video Summarization Application..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "Starting model servers and web interface..." -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Note: Please wait for the model servers to start." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The application will open in your web browser." -ForegroundColor Green
    Write-Host "If it doesn't open automatically, go to: http://localhost:5999" -ForegroundColor Green
    Write-Host ""
    Write-Host "To stop the application, close this window or press Ctrl+C" -ForegroundColor Yellow
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""

    # Run the Python application
    uv run app.py

} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Application has stopped
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Application has stopped." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Read-Host "Press Enter to exit"