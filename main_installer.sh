#!/bin/bash

# Main Intel Platform Installer
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# NPU Driver Version Information
# https://github.com/intel/linux-npu-driver/releases/tag/v1.19.0
export NPU_VERSION="v1.19.0"
export NPU_BUILD_ID="20250707-16111289554"
export NPU_COMMIT_ID="0deed959591f2c3868781bcd5210c67861953f08"
export LEVEL_ZERO_VERSION="v1.22.4"

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Status indicators - using ASCII for better compatibility
S_ERROR="[ERROR]"
S_VALID="[✓]"
S_WARNING="[!]"

# Default values
export INSTALL_CAMERA=false
export INSTALL_OPENVINO=false

# Log file configuration
LOG_FILE="/var/log/intel-platform-installer.log"

# Initialize logging
setup_logging() {
    # Create log directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    
    # Rotate existing log file if it's too large (>10MB)
    if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 10485760 ]; then
        mv "$LOG_FILE" "${LOG_FILE}.old"
        echo "Previous log file rotated to ${LOG_FILE}.old"
    fi
    
    # Create/clear log file with timestamp header
    {
        echo "========================================================================"
        echo "Intel Platform Installer Log"
        echo "========================================================================"
        echo "Installation started: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "Script: $0"
        echo "Arguments: $*"
        echo "User: $(whoami)"
        echo "Working Directory: $(pwd)"
        echo "System Info: $(uname -a)"
        echo "========================================================================"
        echo ""
    } > "$LOG_FILE"
    
    # Ensure log file has proper permissions
    chmod 644 "$LOG_FILE"
    
    # Set up output redirection to both terminal and log file
    exec > >(tee -a "$LOG_FILE")
    exec 2>&1
    
    echo "$S_VALID Logging initialized: $LOG_FILE"
}

# Usage function
usage() {
    echo "Intel Platform Installer"
    echo "========================"
    echo ""
    echo "Usage: $0"
    echo ""
    echo "Supported OS: Ubuntu 24.04 LTS with kernel 6.14.x (HWE) only"
    echo ""
}

# Check if running with appropriate privileges
check_privileges() {
    if [ "$EUID" -ne 0 ]; then
        echo "$S_ERROR This script must be run with sudo or as root user"
        exit 1
    fi
}

download_scripts() {
    local REPO_OWNER="intel"
    local REPO_NAME="edge-developer-kit-reference-scripts"
    local BRANCH="main"
    local BASE_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/refs/heads/${BRANCH}"
    local DOWNLOAD_DIR
    DOWNLOAD_DIR="$(pwd)"

    local REQUIRED_SCRIPTS=(
        "gpu_installer.sh"
        "npu_installer.sh"
        "openvino_installer.sh"
        "print_summary_table.sh"
    )

    # Download scripts
    apt install -y curl
    mkdir -p "$DOWNLOAD_DIR"
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        local url="$BASE_URL/$script"
        local path="$DOWNLOAD_DIR/$script"
        if curl -fsSL "$url" -o "$path"; then
            echo "Downloaded: $script"
        else
            echo "Failed to download: $script"
            return 1
        fi
    done

    # Check scripts
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        local path="$DOWNLOAD_DIR/$script"
        if [[ ! -f "$path" ]]; then
            echo "Missing script: $script"
            return 1
        fi
    done
    echo "All scripts downloaded successfully"

    # Change permissions
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        local path="$DOWNLOAD_DIR/$script"
        if [[ -f "$path" ]]; then
            chmod +x "$path"
            echo "Set executable: $script"
        fi
    done
}

# Verify Ubuntu 24.04 LTS with Canonical kernel
verify_ubuntu_24() {
    echo "# Verifying Ubuntu 24.04 LTS with Canonical kernel..."
    
    # Check OS release
    if [ ! -f /etc/os-release ]; then
        echo "$S_ERROR /etc/os-release file not found"
        exit 1
    fi
    
    # shellcheck disable=SC1091
    source /etc/os-release
    
    # Check Ubuntu version
    if [ "$ID" != "ubuntu" ] || [ "$VERSION_ID" != "24.04" ]; then
        echo "$S_ERROR This installer requires Ubuntu 24.04 LTS"
        echo "Current OS: $PRETTY_NAME"
        echo "Please upgrade to Ubuntu 24.04 LTS before running this script"
        exit 1
    fi

   # Check kernel version (Ubuntu 24.04 LTS - require 6.14.x)
   local kernel_major
   local kernel_minor
   kernel_major=$(uname -r | cut -d'.' -f1)
   kernel_minor=$(uname -r | cut -d'.' -f2)

   # Check for supported kernel versions (6.14.x)
   if ! { [ "$kernel_major" = "6" ] && { [ "$kernel_minor" = "14" ] ; }; }; then
      echo "$S_WARNING Unsupported kernel version: $(uname -r)"
      echo "This installer requires Ubuntu 24.04 LTS with kernel 6.14.x"
      
      # Check HWE support status if command is available
      if command -v hwe-support-status >/dev/null 2>&1; then
         echo "Checking HWE support status..."
         hwe-support-status --verbose
      fi
      
      # Install HWE kernel regardless of hwe-support-status result
      echo "Installing HWE kernel..."
      apt update && apt install -y linux-generic-hwe-24.04
      echo "$S_VALID HWE kernel installed. Please reboot and run this installer again."
      exit 0
   fi

   echo "$S_VALID Ubuntu 24.04 LTS with supported kernel $(uname -r) detected"
}

# Install NPU drivers (Core Ultra only)
install_npu_drivers() {
    # Explicit guard: Only install NPU drivers on Core Ultra platforms
    if ! is_coreultra; then
        echo "$S_ERROR NPU drivers are only supported on Core Ultra platforms"
        echo "Current platform: $CPU_MODEL"
        echo "Skipping NPU driver installation"
        return 1
    fi
    
    echo "Installing NPU drivers for Core Ultra platform..."
    echo "$S_VALID NPU driver installation is supported on this Core Ultra platform"
    
    # Execute the script instead of sourcing it to avoid context issues
    # shellcheck disable=SC1091
    if bash "$SCRIPT_DIR/npu_installer.sh"; then
        echo "$S_VALID NPU drivers installed successfully"
        return 0
    else
        echo "$S_ERROR NPU driver installation failed"
        return 1
    fi
}

# Check for GPU presence
check_intel_arc_gpu() {
    echo "# Checking for GPU devices..."
    
    # Check if lspci is available
    if ! command -v lspci >/dev/null 2>&1; then
        echo "$S_WARNING lspci command not found. Installing pciutils..."
        apt-get update && apt-get install -y pciutils
    fi
    
    # Find any VGA/DISPLAY devices
    local lspci_output
    lspci_output=$(lspci -nn | grep -Ei 'VGA|DISPLAY')
    
    if [ -n "$lspci_output" ]; then
        echo "GPU devices detected:"
        echo "$lspci_output"
        echo "$S_VALID GPU found - proceeding with Intel GPU driver installation"
        return 0
    else
        echo "$S_WARNING No GPU devices detected"
        echo "GPU driver installation will be skipped"
        return 1
    fi
}

# Install GPU drivers - only if any GPU is present
install_gpu_drivers() {
    echo "# GPU Driver Installation Process"
    
    if check_intel_arc_gpu; then
        echo "Installing Intel GPU drivers..."
        # Execute the script instead of sourcing it to avoid context issues
        # shellcheck disable=SC1091
        if bash "$SCRIPT_DIR/gpu_installer.sh"; then
            echo "$S_VALID GPU drivers installed successfully"
            
            # Verify OpenCL setup after installation
            # verify_opencl_setup
            return 0
        else
            echo "$S_ERROR GPU driver installation failed"
            return 1
        fi
    else
        echo "$S_WARNING Skipping GPU driver installation - no GPU devices detected"
        echo "This is normal for systems without dedicated or integrated GPUs"
        return 0  # Not an error condition
    fi
}

# Verify OpenCL setup for both iGPU and dGPU
verify_opencl_setup() {
    echo "# Verifying OpenCL setup..."
    
    # Wait a moment for drivers to load
    sleep 3
    
    # Check system-level GPU detection first
    echo "System GPU detection:"
    echo "1. PCI devices:"
    lspci -nn | grep -Ei 'VGA|DISPLAY' | grep -i intel | while IFS= read -r line; do
        echo "   $line"
    done
    
    echo "2. DRM devices:"
    if ls /dev/dri/ 2>/dev/null; then
        for drm_device in /dev/dri/card* /dev/dri/render*; do
            if [ -e "$drm_device" ]; then
                ls -la "$drm_device"
            fi
        done
    else
        echo "   No DRM devices found"
    fi
    
    echo "3. GPU kernel modules:"
    lsmod | grep -E "i915|xe" || echo "   No Intel GPU modules loaded"
    
    if command -v clinfo >/dev/null 2>&1; then
        echo "4. OpenCL platform detection:"
        if clinfo -l 2>/dev/null; then
            # Count detected devices
            local platform_count device_count
            platform_count=$(clinfo -l 2>/dev/null | grep -c "Platform" || echo "0")
            device_count=$(clinfo -l 2>/dev/null | grep -c "Device" || echo "0")
            
            echo "$S_VALID OpenCL setup verified:"
            echo "  Platforms: $platform_count"
            echo "  Devices: $device_count"
            
            # Show detailed device information
            echo "5. Detailed OpenCL device information:"
            clinfo 2>/dev/null | grep -E "Platform|Device Name|Device Type|Driver Version" | head -10 || echo "   Failed to get detailed info"
            
            if [ "$device_count" -ge 2 ]; then
                echo "$S_VALID Both iGPU and dGPU should be available"
            elif [ "$device_count" -eq 1 ]; then
                echo "$S_WARNING Only one GPU device detected"
                echo "This might be normal if only iGPU or dGPU is functional"
            else
                echo "$S_WARNING No OpenCL devices detected despite installation"
            fi
        else
            echo "$S_WARNING clinfo failed to list OpenCL devices"
            echo "This indicates missing or incorrect OpenCL drivers"
            
            # Enhanced diagnostic commands
            echo "# Enhanced Troubleshooting:"
            echo "1. OpenCL ICD files:"
            if ls /etc/OpenCL/vendors/ 2>/dev/null; then
                ls -la /etc/OpenCL/vendors/
                echo "   ICD file contents:"
                for icd_file in /etc/OpenCL/vendors/*.icd; do
                    if [ -f "$icd_file" ]; then
                        echo "   $(basename "$icd_file"): $(cat "$icd_file" 2>/dev/null || echo 'unreadable')"
                    fi
                done
            else
                echo "   No OpenCL vendor files found"
            fi
            
            echo "2. Intel OpenCL packages:"
            dpkg -l | grep -E "intel.*opencl|intel.*level.*zero|libze" | head -10
            
            echo "3. Library dependencies:"
            if [ -f "/usr/lib/x86_64-linux-gnu/libOpenCL.so.1" ]; then
                echo "   libOpenCL.so.1: Found"
            else
                echo "   libOpenCL.so.1: Missing"
            fi
            
            echo "4. User groups:"
            echo "   Current user groups: $(groups)"
            
            echo ""
            echo "# Common fixes to try:"
            echo "1. Reboot the system: sudo reboot"
            echo "2. Add user to groups: sudo usermod -aG video,render \$USER"
            echo "3. Reinstall OpenCL: sudo apt reinstall intel-opencl-icd intel-level-zero-gpu"
            echo "4. Check dmesg for GPU errors: dmesg | grep -i 'i915\\|gpu\\|drm'"
            echo "5. Re-run GPU installer: sudo ./gpu_installer.sh"
            
            return 1
        fi
        
    else
        echo "$S_ERROR clinfo not available after GPU driver installation"
        echo "This indicates the clinfo package was not properly installed"
        return 1
    fi
}

# Platform detection variables
PLATFORM_FAMILY=""
CPU_MODEL=""
IS_COREULTRA=false

# Detect platform information
detect_platform() {
    echo "Detecting platform family..."

    # Get CPU model
    CPU_MODEL=$(grep -m1 "model name" /proc/cpuinfo | cut -d: -f2 | sed 's/^[ \t]*//' || echo "unknown")
    
    # Detect platform family using a case statement for better readability
    case "$CPU_MODEL" in
        *Ultra*)
            PLATFORM_FAMILY="coreultra"
            IS_COREULTRA=true
            ;;
        *Xeon*)
            PLATFORM_FAMILY="xeon"
            ;;
        *Atom*|*Core*N[0-9]*)
            PLATFORM_FAMILY="atom"
            ;;
        *Core*)
            PLATFORM_FAMILY="core"
            ;;
        *Processor*)
            PLATFORM_FAMILY="processor"
            ;;
        *)
            PLATFORM_FAMILY="unknown"
            ;;
    esac
    
    echo "  CPU Model: $CPU_MODEL"
    echo "  Platform Family: $PLATFORM_FAMILY"
}

# Check if Core Ultra platform
is_coreultra() {
    [ "$IS_COREULTRA" = true ]
}

install_openvino(){
      echo ""
      echo "========================================================================"
      echo "# Installing OpenVINO toolkit..."
      echo "========================================================================"
      
      if [ -f "$SCRIPT_DIR/openvino_installer.sh" ]; then
         echo "Found OpenVINO installer at: $SCRIPT_DIR/openvino_installer.sh"
         echo "Starting OpenVINO installation process..."
         
         if bash "$SCRIPT_DIR/openvino_installer.sh"; then
            echo ""
            echo "$S_VALID OpenVINO toolkit installed successfully"
            
            # Verify installation by checking if virtual environment exists
            if [ -d "/opt/intel/openvino_env" ]; then
               echo "$S_VALID OpenVINO virtual environment confirmed at /opt/intel/openvino_env"
               
               # Additional verification - check if OpenVINO can be imported
               if /opt/intel/openvino_env/bin/python -c "import openvino" 2>/dev/null; then
                  echo "$S_VALID OpenVINO Python package verified and importable"
               else
                  echo "$S_WARNING OpenVINO Python package may not be properly installed"
               fi
            else
               echo "$S_WARNING OpenVINO virtual environment not found at /opt/intel/openvino_env"
            fi
         else
            local exit_code=$?
            echo ""
            echo "$S_ERROR OpenVINO installation failed"
            echo "Exit code: $exit_code"
            echo "Please check the installation logs for details"
            echo "Log file location: /var/log/intel-platform-installer.log"
            return 1
         fi
      else
         echo "$S_ERROR OpenVINO installer not found at $SCRIPT_DIR/openvino_installer.sh"
         echo "Expected location: $SCRIPT_DIR/openvino_installer.sh"
         echo "Current directory: $(pwd)"
         echo "Available files in $SCRIPT_DIR:"
         ls -la "$SCRIPT_DIR"/*.sh 2>/dev/null || echo "No .sh files found"
         return 1
      fi
      
      echo "========================================================================"
}

summary(){
      echo "Running Installation Summary"
      # Execute the script instead of sourcing it to avoid context issues
      # shellcheck disable=SC1091
      bash "$SCRIPT_DIR/print_summary_table.sh"
}

# Install essential development tools
install_build_essentials() {
   echo "# Installing essential development tools..."
   
   apt-get update
   
   if apt-get install -y build-essential gcc g++ make cmake pkg-config git curl wget; then
      echo "$S_VALID Build essentials installed successfully"
   else
      echo "$S_ERROR Failed to install build essentials"
      return 1
   fi
}

# Main execution flow
main() {
    check_privileges
    setup_logging "$@"
    
    echo "Intel Platform Installer"
    echo "========================"
    echo ""
    download_scripts
    # 1. Verify Ubuntu 24.04 LTS with Canonical kernel
    verify_ubuntu_24
    echo ""
    
    # 2. Install essential development tools
    install_build_essentials
    echo ""
    
    # 3. Detect platform
    echo "# Detecting platform..."
    detect_platform
    echo ""
    
    # 5. Platform Installation Flow
    echo "# Platform Installation Flow..."
    echo "$S_VALID Platform detected: $CPU_MODEL"
    
    # Determine platform family and execute appropriate flow
    if is_coreultra; then
        echo ""
        echo "========================================================================"
        echo "# CORE ULTRA PLATFORM INSTALLATION"
        echo "========================================================================"
        echo "Platform: Core Ultra CPU"
        echo "Components: GPU Drivers + NPU Drivers + OpenVINO"
        echo "NPU Support: Available and will be installed"
        echo ""
        
        # Install GPU drivers (will check for GPU presence)
        install_gpu_drivers || echo "$S_WARNING GPU driver installation had issues"
        
        # Install NPU drivers (Core Ultra only)
        install_npu_drivers || echo "$S_WARNING NPU driver installation had issues"
        
        # Install OpenVINO with error handling
        if ! install_openvino; then
            echo "$S_ERROR Core Ultra platform setup incomplete due to OpenVINO installation failure"
            echo "You may retry OpenVINO installation manually: bash $SCRIPT_DIR/openvino_installer.sh"
        fi
        
    else
        echo ""
        echo "========================================================================"
        echo "# STANDARD INTEL PLATFORM INSTALLATION"
        echo "========================================================================"
        echo "Platform: $CPU_MODEL (Xeon/Atom/Core)"
        echo "Components: GPU Drivers (if GPU present) + OpenVINO"
        echo "NPU Support: Not available (Core Ultra only)"
        echo ""
        
        # Install GPU drivers (will check for GPU presence)
        install_gpu_drivers || echo "$S_WARNING GPU driver installation had issues"
        
        # Install OpenVINO with error handling
        if ! install_openvino; then
            echo "$S_ERROR Platform setup incomplete due to OpenVINO installation failure"
            echo "You may retry OpenVINO installation manually: bash $SCRIPT_DIR/openvino_installer.sh"
        fi
    fi
    
    # Run installation summary
    summary
   
    # Log completion
    echo ""
    echo "========================================================================"
    echo "Installation completed: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Log file saved: $LOG_FILE"
    echo "========================================================================"
}

# Execute main function with all arguments
main "$@"
