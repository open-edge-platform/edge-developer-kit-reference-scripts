#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit on error
set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Node.js path from thirdparty
NODE_PATH="$SCRIPT_DIR/../thirdparty/node/bin"

# Function to set up Node.js environment
setup_node_env() {
    echo "Setting up Node.js environment..."
    if [ ! -d "$NODE_PATH" ]; then
        echo "Error: Node.js not found in $NODE_PATH. Please run setup.sh in the project root first."
        exit 1
    fi
    
    OLD_PATH="$PATH"
    export PATH="$NODE_PATH:$PATH"
    
    # Check for node and npm
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: node is not available in PATH."
        exit 1
    fi
    
    if ! command -v npm >/dev/null 2>&1; then
        echo "Error: npm is not available in PATH."
        exit 1
    fi
    
    echo "Node.js version: $(node -v)"
    echo "npm version: $(npm -v)"
}

# Function to reset environment
reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

# Main installation
main() {
    cd "$SCRIPT_DIR"
    
    echo "Setting up Electron Builder environment..."
    setup_node_env
    
    echo "Installing npm dependencies..."
    npm install
    
    echo "Electron Builder setup complete!"
    
    reset_env
}

# Trap to ensure environment is reset on exit
trap reset_env EXIT

main
