#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NODE_PATH="$SCRIPT_DIR/../thirdparty/node/bin"
OLD_PATH="$PATH"

setup_node_env() {
    echo "Setting up Node.js environment..."
    if [ ! -d "$NODE_PATH" ]; then
        echo "Error: Node.js not found in $NODE_PATH. Please run setup.sh in the project root first."
        exit 1
    fi
    
    export PATH="$NODE_PATH:$PATH"
    
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

reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

main() {
    cd "$SCRIPT_DIR"
    
    echo "Setting up Electron Builder environment..."
    setup_node_env
    
    echo "Installing npm dependencies..."
    npm install
    
    echo "Electron Builder setup complete!"
}

trap reset_env EXIT

main