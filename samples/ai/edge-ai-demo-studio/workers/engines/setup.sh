#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_child_setup() {
    local child_dir="$1"
    local child_name
    child_name="$(basename "$child_dir")"
    local setup_script="$child_dir/setup.sh"

    if [[ ! -f "$setup_script" ]]; then
        echo "Warning: No setup.sh found in $child_dir"
        return
    fi

    echo "Running setup for: $child_name"
    chmod +x "$setup_script"
    cd "$child_dir" || {
        echo "ERROR: Failed to cd into $child_dir"
        return 1
    }
    ./setup.sh
    cd "$SCRIPT_DIR" || {
        echo "ERROR: Failed to return to $SCRIPT_DIR"
        return 1
    }
    echo "Setup completed for: $child_name"
}

main() {
    echo "Starting Engine setup..."
    for child_dir in "$SCRIPT_DIR"/*/; do
        [[ -d "$child_dir" ]] && run_child_setup "$child_dir"
    done
    echo "Engine setup completed successfully!"
}

main