#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PARENT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
PARENT_UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"
PARENT_OVMS_PATH="$PARENT_THIRDPARTY_DIR/ovms/bin/ovms"
UV_CMD="$PARENT_UV_PATH"

OVMS_VERSION="v2025.4.1"
OPTIMUM_EXPORT_MODEL_DIR="thirdparty"
OPTIMUM_EXPORT_MODEL_URL="https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/${OVMS_VERSION}/demos/common/export_models"
OPTIMUM_EXPORT_MODEL_SCRIPT="export_model.py"
OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL="requirements.txt"

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

download_file() {
    local url="$1"
    local output="$2"
    local description="${3:-file}"
    
    echo "Downloading $description..."
    if ! curl -L --progress-bar "$url" -o "$output"; then
        echo "Failed to download $description from $url"
        return 1
    fi
    echo "Downloaded $description"
    return 0
}


setup_export_model() {
    echo "Setting up Optimum Export Model"
    
    if [[ -f "$OPTIMUM_EXPORT_MODEL_DIR" ]]; then
        echo "Optimum Export Model script already exists. Skipping setup."
        return 0
    fi
    
    echo "Creating directory: $OPTIMUM_EXPORT_MODEL_DIR"
    mkdir -p "$OPTIMUM_EXPORT_MODEL_DIR"
    
    # Download export_model.py
    if ! download_file "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_SCRIPT" "$OPTIMUM_EXPORT_MODEL_DIR/$OPTIMUM_EXPORT_MODEL_SCRIPT" "Optimum Export Model script"; then
        return 1
    fi
    
    # Download requirements.txt
    if ! download_file "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL" "$OPTIMUM_EXPORT_MODEL_DIR/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL" "Optimum Export Model requirements"; then
        return 1
    fi
    
    # shellcheck disable=SC1091
    if ! $UV_CMD pip install --pre --index-strategy unsafe-best-match -r "$OPTIMUM_EXPORT_MODEL_DIR/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL"; then
        echo "Pip install of OVMS Optimum requirements failed."
        return 1
    fi

    if ! $UV_CMD pip install datasets; then
        echo "Pip install of datasets failed."
        return 1
    fi

    echo "OVMS Optimum requirements installed successfully in virtual environment."
    return 0
}


# Function to install Python dependencies
install_python_dependencies() {
    echo -e "Checking for virtual environment..."
    if [ -d ".venv" ]; then
        echo -e "Virtual environment already exists."
    else
        echo -e "Creating virtual environment with uv..."
        "$UV_CMD" venv
    fi

    echo -e "Installing Python dependencies with uv (this may take a few minutes)..."
    echo -e "Note: If this seems stuck, it might be resolving PyTorch dependencies..."

    if [ -f "requirements.txt" ]; then
        echo -e "Installing requirements.txt dependencies..."
        if "$UV_CMD" pip install -r requirements.txt; then
            echo -e "Python dependencies installed successfully."
        else
            echo -e "Failed to install Python dependencies."
            exit 1
        fi
    else
        echo -e "requirements.txt not found, skipping requirements installation."
    fi
}


# No third-party dependency download in this worker script (handled by parent setup)

# Main execution
main() {
    echo -e "Starting Image Generation Setup..."
    cd "$SCRIPT_DIR"
    check_ovms_installed
    check_uv_installed
    install_python_dependencies
    setup_export_model
    echo -e "Setup completed successfully!"
}

main