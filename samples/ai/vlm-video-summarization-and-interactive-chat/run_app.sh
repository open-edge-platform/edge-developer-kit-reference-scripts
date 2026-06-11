#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

# AI Video Summarization Application
# Make this file executable: chmod +x run_app.sh
# Then run: ./run_app.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}AI Video Summarization Application${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

# Function to print colored status messages
print_status() {
    echo -e "${YELLOW}$1${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_error() {
    echo -e "${RED}$1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if Python is installed
print_status "[1/7] Checking Python installation..."
if command_exists python3; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version 2>&1)
elif command_exists python; then
    PYTHON_VERSION=$(python --version 2>&1)
    # Check if it's Python 3
    if echo "$PYTHON_VERSION" | grep -q "Python 3"; then
        PYTHON_CMD="python"
    else
        print_error "ERROR: Python 3 is required, but only Python 2 was found!"
        print_error "Please install Python 3 from your package manager or https://python.org"
        exit 1
    fi
else
    print_error "ERROR: Python is not installed!"
    print_error "Please install Python 3:"
    print_error "  Ubuntu/Debian: sudo apt update && sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

print_success "Found $PYTHON_VERSION"
echo ""

# Helper function to download files
download_file() {
    local url="$1"
    local output_path="$2"
    
    if command_exists wget; then
        wget -O "$output_path" "$url"
    elif command_exists curl; then
        curl -L -o "$output_path" "$url"
    else
        print_error "Neither wget nor curl is available for downloading"
        return 1
    fi
}

print_status "[2/7] Checking for sample video files..."

# Download sample video files if not present
setup_sample_video() {
    print_status "Setting up sample video files..."
    
    # Create assets directory if it doesn't exist
    if [ ! -d "assets" ]; then
        mkdir -p "assets"
        print_status "Created assets directory"
    fi
    
    # Download first sample video
    if [ -f "assets/traffic-intersection.mp4" ]; then
        print_status "First sample video already exists, skipping download"
    else
        # Download first sample video file
        local video_url1="https://github.com/open-edge-platform/edge-ai-resources/raw/refs/heads/main/videos/1122south_h264.ts"
        local download_path1="assets/1122south_h264.ts"
        
        print_status "Downloading first sample video*..."
        if download_file "$video_url1" "$download_path1"; then
            print_status "First sample video downloaded successfully"
            
            # Convert and cut first video if FFmpeg is available
            if command_exists ffmpeg; then
                print_status "Converting and cutting first video (4:31 to 6:31)..."
                if ffmpeg -i "assets/1122south_h264.ts" -ss 00:04:31 -t 00:02:00 -c copy "assets/traffic-intersection.mp4"; then
                    print_status "First video converted and cut successfully to MP4"
                    rm "assets/1122south_h264.ts"
                    print_status "Cleaned up temporary TS file"
                else
                    print_error "Failed to convert and cut first video"
                fi
            else
                print_status "FFmpeg not found. Keeping TS file for manual conversion"
            fi
        else
            print_error "Failed to download first sample video"
            print_status "Please manually download from: $video_url1"
        fi
    fi
    
    # Download second sample video
    if [ -f "assets/store-aisle-detection.mp4" ]; then
        print_status "Second sample video already exists, skipping download"
    else
        # Download second sample video file (already in MP4 format)
        local video_url2="https://github.com/intel-iot-devkit/sample-videos/raw/master/store-aisle-detection.mp4"
        local download_path2="assets/store-aisle-detection.mp4"
        
        print_status "Downloading second sample video*..."
        if download_file "$video_url2" "$download_path2"; then
            print_status "Second sample video downloaded successfully"
        else
            print_error "Failed to download second sample video"
            print_status "Please manually download from: $video_url2"
        fi
    fi
    
    # Download third sample video
    if [ -f "assets/worker-safety-gear.mp4" ]; then
        print_status "Third sample video already exists, skipping download"
    else
        # Download third sample video file (already in MP4 format)
        local video_url3="https://github.com/intel-iot-devkit/safety-gear-detector-cpp/raw/master/resources/Safety_Full_Hat_and_Vest.mp4"
        local download_path3="assets/Safety_Full_Hat_and_Vest.mp4"
        
        print_status "Downloading third sample video*..."
        if download_file "$video_url3" "$download_path3"; then
            print_status "Third sample video downloaded successfully"
            
            # Rename to more descriptive filename
            if [ -f "$download_path3" ]; then
                mv "$download_path3" "assets/worker-safety-gear.mp4"
                print_status "Renamed video to worker-safety-gear.mp4"
            fi
        else
            print_error "Failed to download third sample video"
            print_status "Please manually download from: $video_url3"
        fi
    fi
    
    # Display FFmpeg installation instructions if needed
    if ! command_exists ffmpeg; then
        print_error "FFmpeg not found. Please install FFmpeg for video processing capabilities"
        print_status "Install FFmpeg: sudo apt install ffmpeg (Ubuntu*/Debian*)"
        if [ -f "assets/1122south_h264.ts" ]; then
            print_status "After installing FFmpeg, run: ffmpeg -i assets/1122south_h264.ts -c copy assets/traffic-intersection.mp4"
        fi
    fi
}

setup_sample_video

print_success "Sample videos are available."
echo ""

# Download Llamacpp binaries if not present
print_status "[3/7] Checking Llama-cpp binaries..."
LLAMACPP_VERSION="b7223"

# Function to download and extract binaries
download_binaries() {
    local binary_dir="llama-${LLAMACPP_VERSION}-bin-ubuntu-vulkan-x64"

    if [ ! -d "./$binary_dir" ]; then
        print_status "Llama-cpp binaries not found. Downloading..."
        
        # Determine the correct URL based on OS
        local url="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMACPP_VERSION}/llama-${LLAMACPP_VERSION}-bin-ubuntu-vulkan-x64.zip"
        
        local zip_file="${binary_dir}.zip"
        
        if command_exists wget; then
            if wget -O "$zip_file" "$url"; then
                download_success=true
            else
                download_success=false
            fi
        elif command_exists curl; then
            if curl -L -o "$zip_file" "$url"; then
                download_success=true
            else
                download_success=false
            fi
        else
            print_error "ERROR: Neither wget nor curl is available for downloading binaries!"
            print_error "Please install wget or curl and try again."
            exit 1
        fi
        
        if [ "$download_success" = true ]; then
            print_status "Extracting Llama-cpp binaries..."
            if command_exists unzip; then
                unzip -q "$zip_file" -d "${binary_dir}"
                rm "$zip_file"
            else
                print_error "ERROR: unzip is not available for extracting binaries!"
                print_error "Please install unzip and try again."
                exit 1
            fi
        else
            print_error "ERROR: Failed to download binaries!"
            exit 1
        fi
    fi
}

# Call the function to download binaries if needed
download_binaries

print_success "Llama-cpp binaries are available."
echo ""

# Check if virtual environment exists, create if not
print_status "[4/7] Setting up virtual environment..."
if [ ! -d "venv" ]; then
    print_status "Creating virtual environment..."
    if ! $PYTHON_CMD -m venv venv; then
        print_error "ERROR: Failed to create virtual environment!"
        print_error "Make sure python3-venv is installed:"
        print_error "  Ubuntu/Debian: sudo apt install python3-venv"
        exit 1
    fi
    print_success "Virtual environment created successfully."
else
    print_success "Virtual environment already exists."
fi
echo ""

# Activate virtual environment
print_status "[5/7] Activating virtual environment..."
# shellcheck disable=SC1091
if ! source ./venv/bin/activate; then
    print_error "ERROR: Failed to activate virtual environment!"
    exit 1
fi
print_success "Virtual environment activated."
echo ""

# Install/Update dependencies
print_status "[6/7] Installing dependencies..."
print_status "This may take a few minutes on first run..."
if ! pip install -r requirements.txt --quiet; then
    print_error "ERROR: Failed to install dependencies!"
    echo ""
    print_status "Trying to install dependencies with more verbose output..."
    if ! pip install -r requirements.txt; then
        print_error "Installation failed. You may need to install system dependencies:"
        print_error "  Ubuntu/Debian: sudo apt install build-essential python3-dev"
        exit 1
    fi
fi
print_success "Dependencies installed successfully."
echo ""

# Check if we're running in a desktop environment for browser opening
HAS_DISPLAY=false
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || [ "$(uname)" = "Darwin" ]; then
    HAS_DISPLAY=true
fi

# Start the application
print_status "[7/7] Starting AI Video Summarization Application..."
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}Starting model servers and web interface...${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""
print_status "Note: Please wait for the model servers to start."
echo ""
print_success "The application will be available at: http://localhost:5999"
echo ""

if [ "$HAS_DISPLAY" = true ]; then
    print_success "The web browser should open automatically."
else
    print_status "Running in headless mode. Open http://localhost:5999 in your browser."
fi

echo ""
print_status "To stop the application, press Ctrl+C"
echo -e "${CYAN}================================================${NC}"
echo ""

# Function to open browser (if possible)
open_browser() {
    if [ "$HAS_DISPLAY" = true ]; then
        sleep 3  # Wait a bit for the server to start
        if command_exists xdg-open; then
            xdg-open http://localhost:5999 >/dev/null 2>&1 &
        elif command_exists open; then  # macOS
            open http://localhost:5999 >/dev/null 2>&1 &
        elif command_exists firefox; then
            firefox http://localhost:5999 >/dev/null 2>&1 &
        elif command_exists chromium-browser; then
            chromium-browser http://localhost:5999 >/dev/null 2>&1 &
        elif command_exists google-chrome; then
            google-chrome http://localhost:5999 >/dev/null 2>&1 &
        fi
    fi
}

# Start browser opener in background
open_browser &

# Set up signal handlers for clean shutdown
cleanup() {
    echo ""
    echo -e "${CYAN}================================================${NC}"
    echo -e "${CYAN}Shutting down application...${NC}"
    echo -e "${CYAN}================================================${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Run the Python application
$PYTHON_CMD app.py

# If we get here, the app has stopped
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}Application has stopped.${NC}"
echo -e "${CYAN}================================================${NC}"