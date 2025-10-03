#!/bin/bash
set -euo pipefail

# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH="$(cd "$SCRIPT_DIR/../thirdparty/node/bin" && pwd)"

ensure_env_file() {
  echo " Checking for .env.example and .env..."
  if [ ! -f ".env.example" ]; then
    echo "Error:.env.example not found. Please provide this file."
    exit 1
  fi
  if [ ! -f ".env" ]; then
    echo " Creating .env from .env.example..."
    cp .env.example .env
    echo " .env created."
  else
    echo " .env already exists."
  fi
  # Always overwrite PAYLOAD_SECRET in .env with a new value
  PAYLOAD_SECRET=$(openssl rand -hex 32)
  if grep -q '^PAYLOAD_SECRET=' .env; then
    sed -i "s/^PAYLOAD_SECRET=.*/PAYLOAD_SECRET=$PAYLOAD_SECRET/" .env
  else
    echo "PAYLOAD_SECRET=$PAYLOAD_SECRET" >> .env
  fi
  echo " PAYLOAD_SECRET updated in .env."
}

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

setup_frontend_dependencies() {
    echo " Setting up frontend dependencies..."
    setup_node_env
    echo " Installing npm dependencies..."
    if ! npm install; then
        echo "Error:npm install failed."
        exit 1
    fi
    echo " Building frontend..."
    if ! npm run build; then
        echo "Error:npm run build failed."
        exit 1
    fi
    echo " Frontend build completed."
    reset_env
}

clean_frontend() {
    echo " Cleaning node_modules and build artifacts..."
    rm -rf node_modules .next dist
    echo " Clean complete."
}

main() {
    if [[ "${1:-}" == "clean" ]]; then
        clean_frontend
        exit 0
    fi
    echo "Starting frontend setup..."
    ensure_env_file
    setup_frontend_dependencies
    echo "Frontend setup completed successfully."
}

main "$@"