#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

PARENT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
PARENT_UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"
PARENT_OVMS_PATH="$PARENT_THIRDPARTY_DIR/ovms/bin/ovms"
UV_CMD="$PARENT_UV_PATH"

# Function to check if uv is installed in parent thirdparty directory
check_uv_installed() {
    echo -e "Checking if uv is installed in parent thirdparty directory..."
    if [ -x "$PARENT_UV_PATH" ]; then
        echo -e "Found uv in parent thirdparty folder."
    else
        echo -e "uv not found in expected location: $PARENT_UV_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

check_ovms_installed() {
    echo "Checking if OVMS is installed in parent thirdparty directory..."
    if [ -x "$PARENT_OVMS_PATH" ]; then
        echo -e "Found OVMS in parent thirdparty folder."
    else
        echo -e "OVMS not found in expected location: $PARENT_OVMS_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

create_venv() {
    if [[ -d "$VENV_DIR" ]]; then
        echo "Virtual environment already exists at $VENV_DIR."
    else
        echo "Creating Python 3.11 virtual environment with uv ..."
        "$UV_CMD" venv --seed --python 3.11 "$VENV_DIR"
    fi
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    "$UV_CMD" sync
    "$UV_CMD" run python -m ensurepip
}


# No third-party dependency download in this worker script (handled by parent setup)

main() {
    echo -e "Starting Embedding Setup..."
    cd "$SCRIPT_DIR"
    check_ovms_installed
    check_uv_installed
    create_venv
    echo "Setup completed successfully!"
}

main
