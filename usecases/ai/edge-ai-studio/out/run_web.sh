#!/usr/bin/env bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PORT="8080"

# Define paths relative to the script directory
RESOURCES_DIR="$SCRIPT_DIR/edge-ai-studio-linux-x64/resources"
FRONTEND_DIR="$RESOURCES_DIR/frontend"
NODE_EXECUTABLE="$RESOURCES_DIR/thirdparty/node/bin/node"
SERVER_JS="$FRONTEND_DIR/server.js"

# Check if the frontend directory exists
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Error: Frontend directory not found at $FRONTEND_DIR"
    exit 1
fi

# Check if node executable exists
if [ ! -f "$NODE_EXECUTABLE" ]; then
    echo "Error: Node.js executable not found at $NODE_EXECUTABLE"
    exit 1
fi

# Check if server.js exists
if [ ! -f "$SERVER_JS" ]; then
    echo "Error: server.js not found at $SERVER_JS"
    exit 1
fi

# Change to the frontend directory
cd "$FRONTEND_DIR" || {
    echo "Error: Failed to change to frontend directory"
    exit 1
}

echo "Starting web server..."
echo "Frontend directory: $FRONTEND_DIR"
echo "Node executable: $NODE_EXECUTABLE"
echo "Server script: $SERVER_JS"

# Start the server using the specified node executable
exec "$NODE_EXECUTABLE" server.js