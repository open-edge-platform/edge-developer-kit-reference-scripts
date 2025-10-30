#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Setup script to run setup.sh in all 1-level child directories
# This script will execute setup.sh files in subdirectories like kokoro/, malaya/, etc.

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Running setup for text-to-speech workers from: $SCRIPT_DIR"

# Function to run setup in a child directory
run_child_setup() {
    local child_dir="$1"
    local setup_script="$child_dir/setup.sh"
    
    if [[ -f "$setup_script" ]]; then
        echo "========================================"
        echo "Running setup for: $(basename "$child_dir")"
        echo "========================================"
        
        # Make the setup script executable
        chmod +x "$setup_script"
        
        # Change to the child directory and run setup
        cd "$child_dir"
        ./setup.sh
        
        # Return to the original directory
        cd "$SCRIPT_DIR"
        
        echo "Setup completed for: $(basename "$child_dir")"
        echo ""
    else
        echo "Warning: No setup.sh found in $child_dir"
    fi
}

# Find all 1-level child directories and run their setup scripts
for child_dir in "$SCRIPT_DIR"/*/; do
    if [[ -d "$child_dir" ]]; then
        run_child_setup "$child_dir"
    fi
done

echo "========================================"
echo "All text-to-speech setup scripts completed!"
echo "========================================"