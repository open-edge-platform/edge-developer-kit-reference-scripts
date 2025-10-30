#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH="$(cd "$SCRIPT_DIR/thirdparty/node/bin" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/frontend" && pwd)"

setup_node_env() {
    OLD_PATH="$PATH"
    echo " Setting up Node.js environment..."
    if [ ! -d "$NODE_PATH" ]; then
        echo "Error:Node.js not found in $NODE_PATH. Please run setup.sh in the project root first."
        exit 1
    fi
    export PATH="$NODE_PATH:$PATH"
    trap reset_env EXIT
    # Check for node and npm
    if ! command -v node >/dev/null 2>&1; then
        echo "Error:node is not available in PATH."
        exit 1
    fi
    if ! command -v npm >/dev/null 2>&1; then
        echo "Error:npm is not available in PATH."
        exit 1
    fi
    echo " Node.js version: $(node -v)"
    echo " npm version: $(npm -v)"
}

reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

setup_node_env
cd "$FRONTEND_DIR" || exit
npm run start
reset_env