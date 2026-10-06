#!/bin/bash

# Simple OpenVINO Device Detection Test Script
# Creates temporary environment, tests OpenVINO devices, cleans up
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Status indicators
S_ERROR="[ERROR]"
S_VALID="[✓]"

# OpenVINO device detection test function
test_openvino_devices() {
    echo "======================================================================"
    echo "OpenVINO Device Detection"
    echo "======================================================================"
    echo ""
    
    # Create temporary directory for testing
    local test_dir
    test_dir="/tmp/openvino_test_$(date +%s)"
    mkdir -p "$test_dir"
    
    # Change to test directory
    if ! cd "$test_dir"; then
        echo -e "${RED}$S_ERROR Failed to create test directory${NC}"
        return 1
    fi
    
    echo -e "${BLUE}Step 1: Installing python3-venv python3-pip${NC}"
    if ! apt-get update >/dev/null 2>&1; then
        echo -e "${RED}$S_ERROR Failed to update package lists${NC}"
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    if ! apt-get install -y python3-venv python3-pip >/dev/null 2>&1; then
        echo -e "${RED}$S_ERROR Failed to install python3-venv python3-pip${NC}"
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    echo -e "${BLUE}Step 2: Creating virtual environment (python3 -m venv test_env)${NC}"
    if ! python3 -m venv test_env; then
        echo -e "${RED}$S_ERROR Failed to create virtual environment${NC}"
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    echo -e "${BLUE}Step 3: Activating virtual environment (source test_env/bin/activate)${NC}"
    # shellcheck disable=SC1091
    if ! source test_env/bin/activate; then
        echo -e "${RED}$S_ERROR Failed to activate virtual environment${NC}"
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    echo -e "${BLUE}Step 4: Upgrading pip (pip install -U pip)${NC}"
    if ! pip install -U pip >/dev/null 2>&1; then
        echo -e "${RED}$S_ERROR Failed to upgrade pip${NC}"
        deactivate
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    echo -e "${BLUE}Step 5: Installing OpenVINO (pip install openvino)${NC}"
    if ! pip install openvino >/dev/null 2>&1; then
        echo -e "${RED}$S_ERROR Failed to install OpenVINO${NC}"
        deactivate
        cleanup_test_env "$test_dir"
        return 1
    fi
    
    echo -e "${BLUE}Step 6: Running OpenVINO device detection${NC}"
    echo "======================================================================"
    
    # Run the exact Python code for device detection
    local python_result
    python_result=$(python3 << 'EOF'
import openvino as ov

try:
    core = ov.Core()
    devices = core.available_devices
    
    print("OpenVINO Device Detection Results:")
    print("-" * 40)
    
    if not devices:
        print("No OpenVINO devices detected!")
        exit(1)
    else:
        for device in devices:
            try:
                device_name = core.get_property(device, 'FULL_DEVICE_NAME')
                print(f"{device}: {device_name}")
            except Exception as e:
                print(f"{device}: Error getting device name - {e}")
        
        print("-" * 40)
        print(f"Total devices detected: {len(devices)}")
    
except ImportError as e:
    print(f"Failed to import OpenVINO: {e}")
    exit(1)
except Exception as e:
    print(f"Error during device detection: {e}")
    exit(1)
EOF
)
    local python_exit_code=$?
    
    # Display results
    echo "$python_result"
    echo "======================================================================"
    
    # Deactivate virtual environment
    deactivate
    
    # Clean up temporary directory (removes virtual environment)
    echo -e "${BLUE}Cleaning up temporary environment and virtual environment...${NC}"
    cleanup_test_env "$test_dir"
    
    # Return result
    if [ $python_exit_code -eq 0 ]; then
        echo ""
        echo -e "${GREEN}$S_VALID OpenVINO device detection test completed successfully${NC}"
        echo ""
        return 0
    else
        echo ""
        echo -e "${RED}$S_ERROR OpenVINO device detection test failed${NC}"
        return 1
    fi
}

# Cleanup function - removes temporary directory and virtual environment
cleanup_test_env() {
    local test_dir="$1"
    cd / || return 1
    if [ -n "$test_dir" ] && [ -d "$test_dir" ]; then
        echo "  Removing temporary directory: $test_dir"
        echo "  This includes the virtual environment and all installed packages"
        rm -rf "$test_dir"
        echo "  Cleanup completed - no traces left on system"
    fi
}

# Main execution function
main() {
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}$S_ERROR This script must be run with sudo or as root${NC}"
        echo "Usage: sudo bash $0"
        exit 1
    fi
    
    # Run the test
    test_openvino_devices
}

# Only run main if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
