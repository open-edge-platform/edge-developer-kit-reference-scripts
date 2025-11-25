#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit on error, unset variable, or failed pipe
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="${1:-$SCRIPT_DIR/../../thirdparty}"
NODE_ZIP_PATH="$THIRDPARTY_DIR/node.tar.xz"
NODE_URL="https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz"
NODE_DIR="$THIRDPARTY_DIR/node"
NODE_PATH="$NODE_DIR/bin/node"

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

setup_thirdparty

