#!/bin/bash
# Copyright (C) 2026 Intel Corporation
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

get_frontend_port() {
    local port
    port="$(grep -E '^PORT=' "$FRONTEND_DIR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '[:space:]"')"
    echo "${port:-8080}"
}

fetch_url() {
    if command -v curl >/dev/null 2>&1; then
        curl -sfL -o /dev/null --max-time 10 "$1"
    else
        wget -q -O /dev/null -T 10 "$1"
    fi
}

wait_for_frontend() {
    local url="$1"
    local pid="$2"
    local retries=120
    echo " Waiting for frontend to become ready at $url ..."
    for _ in $(seq 1 "$retries"); do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "Error: frontend process exited before becoming ready."
            return 1
        fi
        if fetch_url "$url"; then
            return 0
        fi
        sleep 2
    done
    echo "Error: frontend did not respond at $url within timeout."
    return 1
}

setup_node_env
cd "$FRONTEND_DIR" || exit

FRONTEND_URL="http://localhost:$(get_frontend_port)"
HEALTHCHECK_URL="$FRONTEND_URL/api/services"

npm run start &
NPM_PID=$!
trap 'kill "$NPM_PID" 2>/dev/null' INT TERM

if wait_for_frontend "$HEALTHCHECK_URL" "$NPM_PID"; then
    echo " Frontend start completed. Server is ready at $FRONTEND_URL"
fi

wait "$NPM_PID"
reset_env