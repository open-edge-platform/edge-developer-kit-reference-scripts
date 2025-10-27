#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit on error, unset variable, or failed pipe
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="${1:-$SCRIPT_DIR/../thirdparty}"
NODE_ZIP_PATH="$THIRDPARTY_DIR/node.tar.xz"
NODE_URL="https://nodejs.org/dist/v22.18.0/node-v22.18.0-linux-x64.tar.xz"
NODE_DIR="$THIRDPARTY_DIR/node"
NODE_PATH="$NODE_DIR/bin/node"

setup_thirdparty() {
  echo "Creating thirdparty directory at $THIRDPARTY_DIR..."
  mkdir -p "$THIRDPARTY_DIR"
  install_node
}

# Install Node.js if not already present
install_node() {
  if [ ! -f "$NODE_PATH" ]; then
    echo "Installing Node.js ..."
    mkdir -p "$NODE_DIR"
    echo "Downloading Node.js from $NODE_URL ..."
    wget -q -O "$NODE_ZIP_PATH" "$NODE_URL"
    tar -xJf "$NODE_ZIP_PATH" -C "$NODE_DIR" --strip-components=1
    rm "$NODE_ZIP_PATH"
    echo "Node.js installed at $NODE_PATH"
  else
    echo "Node.js already installed."
  fi
}

setup_thirdparty

