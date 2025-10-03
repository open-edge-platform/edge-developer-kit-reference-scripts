#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
UV_ZIP_PATH="$THIRDPARTY_DIR/uv.zip"
UV_ZIP_URL="https://github.com/astral-sh/uv/releases/download/0.8.13/uv-x86_64-unknown-linux-gnu.tar.gz"
UV_DIR="$THIRDPARTY_DIR/uv"
UV_PATH="$UV_DIR/uv"

OVMS_ZIP_PATH="$THIRDPARTY_DIR/ovms.tar.gz"
OVMS_ZIP_URL_UBUNTU22="https://github.com/openvinotoolkit/model_server/releases/download/v2025.2.1/ovms_ubuntu22_python_on.tar.gz"
OVMS_ZIP_URL_UBUNTU24="https://github.com/openvinotoolkit/model_server/releases/download/v2025.2.1/ovms_ubuntu24_python_on.tar.gz"
OVMS_DIR="$THIRDPARTY_DIR/ovms"

FFMPEG_TAR_PATH="$THIRDPARTY_DIR/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_TAR_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_DIR="$THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

# Function to check if uv is installed
check_uv_installed() {
    echo "Checking if uv is installed..."
    if [ -x "$UV_PATH" ]; then
        echo "uv found in thirdparty folder."
        "$UV_PATH" --version >/dev/null 2>&1
        return 0
    fi
    echo "uv is not installed. Downloading uv binary..."
    mkdir -p "$THIRDPARTY_DIR"
    mkdir -p "$UV_DIR"
    echo "Downloading uv from $UV_ZIP_URL..."
    if [[ $VERBOSE -eq 1 ]]; then
        wget -O "$UV_ZIP_PATH" "$UV_ZIP_URL"
    else
        wget -q -O "$UV_ZIP_PATH" "$UV_ZIP_URL"
    fi
    echo "Extracting uv binary..."
    tar --strip-components=1 -xzf "$UV_ZIP_PATH" -C "$UV_DIR"
    rm "$UV_ZIP_PATH"
    if "$UV_PATH" --version >/dev/null 2>&1; then
        echo "uv is successfully downloaded and extracted."
        return 0
    else
        echo "ERROR: Failed to download/extract uv."
        echo "Please manually download uv from: https://github.com/astral-sh/uv/releases"
        echo "Extract uv to: $SCRIPT_DIR/thirdparty/uv/"
        exit 1
    fi
}

# Function to download third-party dependencies
get_thirdparty_dependencies() {
    echo "Creating thirdparty directory..."
    mkdir -p "$THIRDPARTY_DIR"

    if [ -d "$OVMS_DIR" ]; then
        echo "OVMS directory already exists. Skipping download."
    else
        echo "Downloading OpenVINO Model Server for Linux..."
        # Detect Ubuntu version
        UBUNTU_VERSION="$(lsb_release -rs | cut -d. -f1)"
        if [ "$UBUNTU_VERSION" = "22" ]; then
            OVMS_ZIP_URL="$OVMS_ZIP_URL_UBUNTU22"
        elif [ "$UBUNTU_VERSION" = "24" ]; then
            OVMS_ZIP_URL="$OVMS_ZIP_URL_UBUNTU24"
        else
            echo "Unsupported Ubuntu version: $UBUNTU_VERSION. Only 22 and 24 are supported."
            exit 1
        fi
        if [[ $VERBOSE -eq 1 ]]; then
            wget -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL"
        else
            wget -q -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL"
        fi
        mkdir -p "$OVMS_DIR"
        tar -xzf "$OVMS_ZIP_PATH" -C "$OVMS_DIR" --strip-components=1
        rm "$OVMS_ZIP_PATH"
        echo "OVMS downloaded and extracted successfully."
    fi

    # Install FFmpeg
    if [ -d "$FFMPEG_DIR" ]; then
        echo "FFmpeg directory already exists. Skipping download."
    else
        echo "Downloading FFmpeg for Linux..."
        if [[ $VERBOSE -eq 1 ]]; then
            wget -O "$FFMPEG_TAR_PATH" "$FFMPEG_TAR_URL"
        else
            wget -q -O "$FFMPEG_TAR_PATH" "$FFMPEG_TAR_URL"
        fi
        
        # Extract FFmpeg
        tar -xf "$FFMPEG_TAR_PATH" -C "$THIRDPARTY_DIR"
        
        # Find the extracted directory and set up ffmpeg structure
        EXTRACTED_DIR=$(find "$THIRDPARTY_DIR" -maxdepth 1 -type d -name "ffmpeg-*" | head -1)
        if [ -n "$EXTRACTED_DIR" ]; then
            # Create ffmpeg directory structure
            mkdir -p "$FFMPEG_DIR/bin"
            
            # Copy ffmpeg binaries
            cp "$EXTRACTED_DIR/ffmpeg" "$FFMPEG_DIR/bin/"
            cp "$EXTRACTED_DIR/ffprobe" "$FFMPEG_DIR/bin/"
            
            # Make executable
            chmod +x "$FFMPEG_DIR/bin/ffmpeg"
            chmod +x "$FFMPEG_DIR/bin/ffprobe"
            
            # Clean up extracted directory
            rm -rf "$EXTRACTED_DIR"
        fi
        
        # Clean up tar file
        rm -f "$FFMPEG_TAR_PATH"
        
        if [ -x "$FFMPEG_PATH" ]; then
            echo "FFmpeg downloaded and extracted successfully."
        else
            echo "FFmpeg installation verification failed."
        fi
    fi
}

setup_workers() {
    # Discover all subdirectories with setup.sh files
    WORKER_DIRS=$(find "$SCRIPT_DIR" -maxdepth 1 -type d ! -path "$SCRIPT_DIR" | while read -r dir; do
        if [ -f "$dir/setup.sh" ]; then
            echo "$dir"
        fi
    done)

    if [ -z "$WORKER_DIRS" ]; then
        echo "No worker directories with setup.sh found."
        exit 0
    fi

    # Determine skip mapping for known workers
    declare -A SKIP_MAP
    SKIP_MAP["text-generation"]=$SKIP_STT
    SKIP_MAP["text-generation"]=$SKIP_EMBEDDING
    SKIP_MAP["text-generation"]=$SKIP_LLM
    SKIP_MAP["text-to-speech"]=$SKIP_TTS

    echo "Found worker directories:"
    for dir in $WORKER_DIRS; do
        name=$(basename "$dir")
        status=""
        if [[ ${SKIP_MAP[$name]:-0} -eq 1 ]]; then
            status=" (SKIPPED)"
        fi
        echo "  - $name$status"
    done
    echo "================="
    for worker_dir in $WORKER_DIRS; do
        name=$(basename "$worker_dir")
        if [[ ${SKIP_MAP[$name]:-0} -eq 1 ]]; then
            echo "Skipping $name setup..."
            continue
        fi
        echo "Starting $name setup..."
        setup_script="$worker_dir/setup.sh"
        if [ ! -f "$setup_script" ]; then
            echo "Warning: setup.sh not found in $worker_dir, skipping..."
            continue
        fi
        if [[ $VERBOSE -eq 1 ]]; then
            bash -x "$setup_script"
            rc=$?
        else
            bash "$setup_script" >/dev/null 2>&1
            rc=$?
        fi
        if [ $rc -eq 0 ]; then
            echo "$name setup completed successfully!"
        else
            echo "$name setup failed!"
            exit 1
        fi
    done
    echo "All worker setup processes completed successfully!"
}

main() {
    # Main script
    echo "=== Workers Setup ==="

    cd "$SCRIPT_DIR"
    check_uv_installed
    get_thirdparty_dependencies
    if [[ $SETUP_WORKERS -eq 1 ]]; then
        setup_workers
    else
        echo "Skipping worker setup (default). Use --setup-workers to enable."
    fi
}

# --- Argument parsing ---

# Default: skip worker setup unless --setup-workers is provided
SKIP_STT=0
SKIP_EMBEDDING=0
SKIP_LLM=0
SKIP_TTS=0
VERBOSE=0
SETUP_WORKERS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-stt)
            SKIP_STT=1
            shift
            ;;
        --skip-embedding)
            SKIP_EMBEDDING=1
            shift
            ;;
        --skip-llm)
            SKIP_LLM=1
            shift
            ;;
        --skip-tts)
            SKIP_TTS=1
            shift
            ;;
        --verbose)
            VERBOSE=1
            shift
            ;;
        --setup-workers)
            SETUP_WORKERS=1
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

main