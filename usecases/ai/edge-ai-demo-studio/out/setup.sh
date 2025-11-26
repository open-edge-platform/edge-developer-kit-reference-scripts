#!/usr/bin/env bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Define paths
RESOURCES_DIR="$SCRIPT_DIR/linux-unpacked/resources"
ACTUAL_SETUP="$RESOURCES_DIR/setup.sh"

# Check if the actual setup script exists
if [ ! -f "$ACTUAL_SETUP" ]; then
    echo "Error: Setup script not found at $ACTUAL_SETUP"
    exit 1
fi

# Change to resources directory and run the actual setup script
cd "$RESOURCES_DIR" || {
    echo "Error: Failed to change to resources directory"
    exit 1
}

echo "Running setup from $ACTUAL_SETUP..."
exec bash "$ACTUAL_SETUP" --skip-frontend
