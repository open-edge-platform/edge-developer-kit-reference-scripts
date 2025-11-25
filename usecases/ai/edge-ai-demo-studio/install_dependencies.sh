#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

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

if [ -z "${SUDO_USER:-}" ]; then
  echo "Error: SUDO_USER is not set. Please run this script with sudo from a non-root user account."
  exit 1
fi

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
  local system_packages="curl wget libxml2 git software-properties-common"
  
  if ! install_and_verify_packages "$system_packages" "system dependencies"; then
    echo "❌ ERROR: Failed to install system dependencies"
    exit 1
  fi
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
      echo "sudo bash -c \"\$(wget -qLO - https://raw.githubusercontent.com/intel/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)\""
      echo ""
      exit 1
    fi
  else
    echo "Auto-accepting driver installation (non-interactive mode)..."
  fi
  
  echo ""
  echo "📥 Downloading driver installer script..."
  
  local driver_script="/tmp/main_installer.sh"
  local driver_script_url="https://raw.githubusercontent.com/intel/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh"
  
  if ! wget -q --show-progress -O "$driver_script" "$driver_script_url"; then
    echo "❌ ERROR: Failed to download driver installer script"
    echo "Please manually download and run the script from:"
    echo "  $driver_script_url"
    exit 1
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
  cd /tmp || exit 1
  
  if ! "$driver_script"; then
    echo ""
    echo "❌ ERROR: Driver installation failed"
    echo "Please check the error messages above and try again"
    cd "$original_dir" || true
    exit 1
  fi
  
  # Return to original directory
  cd "$original_dir" || exit 1
}


main() {
  echo "=========================================="
  echo "Installing System Dependencies"
  echo "=========================================="
  echo ""
  
  install_system_dependencies
  echo ""
  
  download_espeak_ng
  echo ""
  
  install_drivers
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
