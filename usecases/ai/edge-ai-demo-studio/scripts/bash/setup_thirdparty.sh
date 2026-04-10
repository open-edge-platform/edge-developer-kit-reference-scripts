#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit on error, unset variable, or failed pipe
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="${1:-$SCRIPT_DIR/../../thirdparty}"
NODE_ZIP_PATH="$THIRDPARTY_DIR/node.tar.xz"
NODE_URL="https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz"
NODE_DIR="$THIRDPARTY_DIR/node"
NODE_PATH="$NODE_DIR/bin/node"

FFMPEG_TAR_PATH="$THIRDPARTY_DIR/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_TAR_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_DIR="$THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

# Cleanup temporary files on exit or interruption
cleanup_temp_files() {
    rm -f "$NODE_ZIP_PATH" "$FFMPEG_TAR_PATH" 2>/dev/null
}
trap cleanup_temp_files EXIT INT TERM

setup_thirdparty() {
  echo "Creating thirdparty directory at $THIRDPARTY_DIR..."
  if ! mkdir -p "$THIRDPARTY_DIR"; then
    echo "❌ ERROR: Failed to create thirdparty directory at $THIRDPARTY_DIR"
    exit 1
  fi
  
  if ! install_node; then
    echo "❌ ERROR: Node.js installation failed"
    exit 1
  fi
  
  if ! install_ffmpeg; then
    echo "❌ ERROR: FFmpeg installation failed"
    exit 1
  fi
  
  echo "✅ Thirdparty setup completed successfully"
}

# Install Node.js if not already present
install_node() {
  if [ ! -f "$NODE_PATH" ]; then
    echo "Installing Node.js ..."
    
    if ! mkdir -p "$NODE_DIR"; then
      echo "❌ ERROR: Failed to create Node.js directory at $NODE_DIR"
      return 1
    fi
    
    echo "Downloading Node.js from $NODE_URL ..."
    if ! wget -q -O "$NODE_ZIP_PATH" "$NODE_URL"; then
      echo "❌ ERROR: Failed to download Node.js from $NODE_URL"
      echo "Please check your internet connection and try again."
      return 1
    fi
    
    echo "Extracting Node.js..."
    if ! tar -xJf "$NODE_ZIP_PATH" -C "$NODE_DIR" --strip-components=1; then
      echo "❌ ERROR: Failed to extract Node.js archive"
      rm -f "$NODE_ZIP_PATH"
      return 1
    fi
    
    rm "$NODE_ZIP_PATH"
    
    # Verify installation
    if [ ! -f "$NODE_PATH" ]; then
      echo "❌ ERROR: Node.js binary not found at $NODE_PATH after extraction"
      return 1
    fi
    
    if ! "$NODE_PATH" --version >/dev/null 2>&1; then
      echo "❌ ERROR: Node.js installation verification failed"
      return 1
    fi
    
    echo "✅ Node.js installed successfully at $NODE_PATH"
  else
    echo "Node.js already installed at $NODE_PATH"
  fi
  
  return 0
}

# Install FFmpeg if not already present
install_ffmpeg() {
  if [ -d "$FFMPEG_DIR" ]; then
    echo "✅ FFmpeg directory already exists at $FFMPEG_DIR. Skipping download."
    return 0
  fi
  
  echo "Downloading FFmpeg for Linux..."
  echo "Downloading from $FFMPEG_TAR_URL..."
  if ! wget -q -O "$FFMPEG_TAR_PATH" "$FFMPEG_TAR_URL"; then
    echo "❌ ERROR: Failed to download FFmpeg"
    return 1
  fi
  
  # Extract FFmpeg
  echo "Extracting FFmpeg..."
  if ! tar -xf "$FFMPEG_TAR_PATH" -C "$THIRDPARTY_DIR"; then
    echo "❌ ERROR: Failed to extract FFmpeg archive"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  # Find the extracted directory and set up ffmpeg structure
  EXTRACTED_DIR=$(find "$THIRDPARTY_DIR" -maxdepth 1 -type d -name "ffmpeg-*" | head -1)
  if [ -z "$EXTRACTED_DIR" ]; then
    echo "❌ ERROR: Could not find extracted FFmpeg directory"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  # Create ffmpeg directory structure
  if ! mkdir -p "$FFMPEG_DIR/bin"; then
    echo "❌ ERROR: Failed to create FFmpeg bin directory"
    rm -rf "$EXTRACTED_DIR"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  # Copy ffmpeg binaries
  if ! cp "$EXTRACTED_DIR/ffmpeg" "$FFMPEG_DIR/bin/" || \
     ! cp "$EXTRACTED_DIR/ffprobe" "$FFMPEG_DIR/bin/"; then
    echo "❌ ERROR: Failed to copy FFmpeg binaries"
    rm -rf "$EXTRACTED_DIR"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  # Make executable
  chmod +x "$FFMPEG_DIR/bin/ffmpeg"
  chmod +x "$FFMPEG_DIR/bin/ffprobe"
  
  # Clean up extracted directory
  rm -rf "$EXTRACTED_DIR"
  
  # Clean up tar file
  rm -f "$FFMPEG_TAR_PATH"
  
  # Verify installation
  if [ ! -x "$FFMPEG_PATH" ]; then
    echo "❌ ERROR: FFmpeg installation verification failed - binary not found or not executable"
    return 1
  fi
  
  if ! "$FFMPEG_PATH" -version >/dev/null 2>&1; then
    echo "❌ ERROR: FFmpeg binary found but not working properly"
    return 1
  fi
  
  echo "✅ FFmpeg downloaded and extracted successfully."
  return 0
}

setup_thirdparty

