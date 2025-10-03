#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH="$(cd "$SCRIPT_DIR/../thirdparty/node/bin" && pwd)"

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
    # Check for package.json
    if [ ! -f "package.json" ]; then
        echo "Error:package.json not found in electron directory."
        exit 1
    fi
}

reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

setup_electron_dependencies() {
    echo " Setting up electron dependencies..."
    setup_node_env
    echo " Installing npm dependencies..."
    if ! npm install; then
        echo "Error:npm install failed."
        exit 1
    fi
    reset_env
}

clean_electron() {
    echo " Cleaning node_modules and build artifacts..."
    rm -rf node_modules
    echo " Clean complete."
}

main() {
    if [[ "${1:-}" == "clean" ]]; then
        clean_electron
        exit 0
    fi
    echo "Starting electron setup..."
    setup_electron_dependencies
    echo "electron setup completed successfully."
}

main "$@"