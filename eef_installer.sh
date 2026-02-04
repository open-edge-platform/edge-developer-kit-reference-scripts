#!/bin/bash

# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

EEF_SCRIPT="https://raw.githubusercontent.com/open-edge-platform/edge-ai-libraries/refs/heads/main/frameworks/edgedevice-enablement-framework/base/va_enablement_node_profile/va_enablement_node_profile.sh"

prerequisites_pkgs(){
    echo "Installing prerequisites packages..."
    apt-get update
    apt-get install -y curl    
}

eef_execution() {
    echo "Starting EEF installation..."

    # Check if the EEF script is reachable
    if ! curl --output /dev/null --silent --head --fail "$EEF_SCRIPT"; then
        echo "EEF script is not reachable. Please check your internet connection or the URL."
        exit 1
    fi  

    # Download EEF script
    echo "Downloading EEF script..."
    if [ -f ./va_enablement_node_profile.sh ]; then
        echo "The script already exists."
    else
        curl -sSL "$EEF_SCRIPT" -o ./va_enablement_node_profile.sh

        # Set execute permissions for the installed script
        echo "Setting execute permissions for the installed script..."
        chmod +x ./va_enablement_node_profile.sh
    fi

    # Executes the EEF script
    echo "Executing the EEF script..."
    bash ./va_enablement_node_profile.sh

}

# Main function to orchestrate the installation
main() {
    prerequisites_pkgs
    eef_execution
}

main