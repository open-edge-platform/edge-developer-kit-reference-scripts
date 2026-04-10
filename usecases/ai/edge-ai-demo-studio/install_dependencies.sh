#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

XPU_SMI_RELEASE_URL="https://github.com/intel/xpumanager/releases/download/v1.3.6/xpu-smi_1.3.6_20260206.143628.1004f6cb.u24.04_amd64.deb"
XPU_SMI_DOWNLOAD_FILE="xpu-smi.deb"

# Parse command-line arguments
AUTO_YES=false
while getopts "y" opt; do
  case $opt in
    y)
      AUTO_YES=true
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      echo "Usage: $0 [-y]"
      echo "  -y    Auto-accept all prompts (non-interactive mode)"
      exit 1
      ;;
  esac
done

# Handle root execution (Docker/CI)
if [ "$EUID" -eq 0 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
        sudo() { "$@"; }
    fi
fi

if [ -z "${SUDO_USER:-}" ]; then
  if [ "$EUID" -eq 0 ]; then
    echo "Warning: SUDO_USER is not set, but running as root (likely Docker/CI). Proceeding..."
  else
    echo "Error: SUDO_USER is not set. Please run this script with sudo from a non-root user account."
    exit 1
  fi
fi

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

download_deb_file() {
    local url="$1"
    local output="$2"
    local description="${3:-file}"
    
    echo "Downloading $description..."
  # Fail on HTTP errors, follow redirects and be silent about progress
  if ! curl -fSL -o "$output" "$url"; then
    echo "❌ ERROR: Failed to download $description from $url"
    return 1
  fi

  # Basic validation: ensure the file looks like a .deb (dpkg-deb can read it)
  if ! dpkg-deb -I "$output" >/dev/null 2>&1; then
    echo "❌ ERROR: Downloaded $description does not appear to be a valid .deb: $output"
    rm -f "$output"
    return 1
  fi

  echo "✅ Downloaded and validated $description"
    return 0
}

# Dynamic function to install and verify packages
# Usage: install_and_verify_packages "package1 package2 package3" "Package Category Name"
install_and_verify_packages() {
  local packages="$1"
  local category_name="${2:-packages}"
  
  echo "Installing $category_name..."
  
  # Convert space-separated string to array
  local pkg_array
  read -ra pkg_array <<< "$packages"
  
  if ! apt update -y; then
    echo "❌ ERROR: Failed to update apt package list"
    return 1
  fi
  
  if ! apt install -y "${pkg_array[@]}"; then
    echo "❌ ERROR: Failed to install $category_name"
    return 1
  fi
  
  # Verify installation
  echo "Verifying $category_name installation..."
  local missing_packages=()
  
  for pkg in "${pkg_array[@]}"; do
    # Check if it's a command-line tool
    if command -v "$pkg" >/dev/null 2>&1; then
      continue
    # Check if it's an installed package
    elif dpkg -s "$pkg" >/dev/null 2>&1; then
      continue
    else
      missing_packages+=("$pkg")
    fi
  done
  
  if [ ${#missing_packages[@]} -gt 0 ]; then
    echo "❌ ERROR: The following packages failed to install: ${missing_packages[*]}"
    return 1
  fi
  
  echo "✅ $category_name installed successfully"
  return 0
}

install_system_dependencies() {
  local system_packages="curl wget libxml2 git software-properties-common vulkan-tools libportaudio2 unzip"
  
  if ! install_and_verify_packages "$system_packages" "system dependencies"; then
    echo "❌ ERROR: Failed to install system dependencies"
    exit 1
  fi
}


# Check and setup Mesa drivers (kisak-mesa)
check_mesa_drivers() {
    echo "0. Mesa Drivers Check"

    # Only relevant for Debian/Ubuntu (apt)
    if ! command_exists apt-get; then
        echo "Not on a Debian/Ubuntu-based system. Skipping Mesa driver check."
        return
    fi

    # Check if PPA is already added
    if grep -r "kisak/kisak-mesa" /etc/apt/sources.list /etc/apt/sources.list.d/ >/dev/null 2>&1; then
        echo "kisak-mesa PPA is already configured."
        return
    fi

    echo "kisak-mesa PPA not found."

    # Install software-properties-common if missing (needed for add-apt-repository)
    if ! command_exists add-apt-repository; then
        echo "Installing software-properties-common..."
        if ! sudo apt-get update && sudo apt-get install -y software-properties-common; then
            echo "Failed to install software-properties-common."
            exit 1
        fi
    fi

    # Add PPA and update
    echo "Adding PPA: ppa:kisak/kisak-mesa..."
    if ! sudo add-apt-repository -y ppa:kisak/kisak-mesa; then
        echo "Failed to add kisak-mesa PPA."
        exit 1
    fi

    echo "Updating package lists..."
    if ! sudo apt-get update; then
        echo "Failed to update package lists."
        exit 1
    fi

    echo "kisak-mesa PPA added and apt updated."
    echo "To upgrade to the latest Mesa drivers, please run: sudo apt upgrade"
    return 0
}

download_espeak_ng() {
    if dpkg -s espeak-ng &> /dev/null; then
        echo "✅ espeak-ng is already installed."
        return 0
    fi
    
    local espeak_packages="espeak-ng espeak-ng-data libsndfile1"
    
    if ! install_and_verify_packages "$espeak_packages" "espeak-ng and audio libraries"; then
        echo "❌ ERROR: Failed to install espeak-ng packages"
        exit 1
    fi
    
    # Additional verification that espeak-ng command is available
    if ! command -v espeak-ng >/dev/null 2>&1; then
        echo "❌ ERROR: espeak-ng command not found after installation"
        exit 1
    fi
}

install_drivers() {
  echo ""
  echo "=========================================="
  echo "🔧 Driver Installation & Verification"
  echo "=========================================="
  echo ""
  echo "This application requires GPU & NPU drivers to be installed."
  echo ""
  echo "The installer script will perform 3 steps:"
  echo "  1. Check and install Intel GPU drivers"
  echo "  2. Check and install Intel NPU drivers"
  echo "  3. Verify devices can run on OpenVINO runtime"
  echo ""
  echo "Additional setup includes:"
  echo "  • Configure OpenCL runtime"
  echo "  • Set up necessary permissions"
  echo ""
  
  if [ "$AUTO_YES" = false ]; then
    read -p "Would you like to download and run the drivers installer script now? (y/N): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo ""
      echo "⚠️  Driver installation skipped."
      echo ""
      echo "You can manually install drivers later by running:"
      echo "sudo bash -c \"\$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)\""
      echo ""
      return 0
    fi
  else
    echo "Auto-accepting driver installation (non-interactive mode)..."
  fi
  
  echo ""
  echo "📥 Downloading driver installer script..."
  
  local driver_script="/tmp/main_installer.sh"
  local driver_script_url="https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh"
  
  if ! wget -q --show-progress -O "$driver_script" "$driver_script_url"; then
    echo "❌ ERROR: Failed to download driver installer script"
    echo "Please manually download and run the script from:"
    echo "  $driver_script_url"
    return 1
  fi
  
  chmod +x "$driver_script"
  
  echo ""
  echo "🚀 Running driver installer script..."
  echo "This will perform the following:"
  echo "  [1/3] Installing GPU drivers..."
  echo "  [2/3] Installing NPU drivers..."
  echo "  [3/3] Verifying OpenVINO device compatibility..."
  echo ""
  echo "This may take several minutes. Please wait..."
  echo ""
  
  # Save current directory and change to /tmp
  local original_dir
  original_dir=$(pwd)
  cd /tmp || return 1
  
  if ! "$driver_script"; then
    echo ""
    echo "❌ ERROR: Driver installation failed"
    echo "Please check the error messages above and try again"
    rm -f "$driver_script"
    cd "$original_dir" || {
      echo "❌ ERROR: Failed to return to original directory: $original_dir"
      return 1
    }
    return 1
  fi
  
  # Cleanup and return to original directory
  rm -f "$driver_script"
  cd "$original_dir" || {
    echo "❌ ERROR: Failed to return to original directory: $original_dir"
    return 1
  }
}


# Install XPU-SMI (Intel GPU monitoring tool)
install_xpu_smi() {
    echo "XPU-SMI Installation"
    
    if command_exists xpu-smi; then
        echo "✅ XPU-SMI is already installed."
        return 0
    fi
    
    # Download the .deb package
    if ! download_deb_file "$XPU_SMI_RELEASE_URL" "$XPU_SMI_DOWNLOAD_FILE" "XPU-SMI package"; then
        return 1
    fi
    
    # Check if we can install system-wide (requires sudo)
    if command_exists dpkg && [[ $EUID -eq 0 ]]; then
        echo "Installing XPU-SMI system-wide..."
        if sudo apt install -y "./$XPU_SMI_DOWNLOAD_FILE"; then
            rm -f "$XPU_SMI_DOWNLOAD_FILE"
            echo "XPU-SMI installed system-wide."
            return 0
        else
            echo "❌ ERROR: System-wide XPU-SMI installation failed."
            echo "Please install manually: sudo apt install ./$XPU_SMI_DOWNLOAD_FILE"
            rm -f "$XPU_SMI_DOWNLOAD_FILE"
            return 1
        fi
    elif command_exists dpkg && sudo -n true 2>/dev/null; then
        echo "Installing XPU-SMI system-wide..."
        if sudo apt install -y "./$XPU_SMI_DOWNLOAD_FILE"; then
            rm -f "$XPU_SMI_DOWNLOAD_FILE"
            echo "XPU-SMI installed system-wide."
            return 0
        else
            echo "❌ ERROR: System-wide XPU-SMI installation failed."
            echo "Please install manually: sudo apt install ./$XPU_SMI_DOWNLOAD_FILE"
            rm -f "$XPU_SMI_DOWNLOAD_FILE"
            return 1
        fi
    else
        echo "Cannot install system-wide (no sudo access or not on Debian/Ubuntu)"
        rm -f "$XPU_SMI_DOWNLOAD_FILE"
        return 1
    fi
    
}


main() {
  echo "=========================================="
  echo "Installing System Dependencies"
  echo "=========================================="
  echo ""
  
  install_system_dependencies
  echo ""

  check_mesa_drivers
  echo ""
  
  download_espeak_ng
  echo ""
  
  install_drivers
  echo ""

  install_xpu_smi
  echo ""
  
  echo "=========================================="
  echo "✅ All dependencies installed and verified successfully!"
  echo "=========================================="
  echo ""
  echo "Summary:"
  echo "  ✅ System dependencies (curl, wget, git, etc.)"
  echo "  ✅ espeak-ng and audio libraries"
  echo "  ✅ GPU drivers installed and verified"
  echo "  ✅ NPU drivers installed and verified"
  echo "  ✅ OpenVINO runtime compatibility confirmed"
  echo ""
}

main
