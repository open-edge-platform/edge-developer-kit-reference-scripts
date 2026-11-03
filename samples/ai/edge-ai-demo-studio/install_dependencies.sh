#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

AUTO_YES=false
AUTO_NO=false
ONEAPI_ONLY=false

print_usage() {
  cat <<EOF
Usage: sudo $0 [-y|--yes | -n|--no]

Installs the system packages, espeak-ng and the Intel GPU/NPU drivers. Must
be run as root (sudo).

Options:
  -y, --yes       Install the GPU/NPU drivers without asking.
  -n, --no        Skip the GPU/NPU driver installation.
  -h, --help      Show this help and exit.

Non-interactive use (CI, Docker): with no TTY to answer prompts the driver
step requires -y or -n.

The SYCL llama.cpp backend no longer needs the Intel oneAPI Toolkit: ./setup.sh
installs its runtime from Python wheels. --oneapi and --no-oneapi are ignored,
and --oneapi-only exits without doing anything.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=true
      ;;
    -n|--no)
      AUTO_NO=true
      ;;
    --oneapi|--no-oneapi)
      echo "Note: $1 is ignored - the SYCL runtime is installed by ./setup.sh, not the Intel oneAPI Toolkit."
      ;;
    --oneapi-only)
      ONEAPI_ONLY=true
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ "$AUTO_YES" = true ] && [ "$AUTO_NO" = true ]; then
  echo "Error: -y and -n are mutually exclusive." >&2
  exit 1
fi

if [ "$ONEAPI_ONLY" = true ]; then
  echo "Nothing to install: the SYCL llama.cpp backend no longer needs the Intel oneAPI Toolkit."
  echo "Run ./setup.sh --backend sycl to switch the engine over; it installs the SYCL runtime."
  exit 0
fi

# No TTY, or -y/-n given, means non-interactive: keep apt/dpkg off debconf prompts too.
if [ ! -t 0 ] || [ "$AUTO_YES" = true ] || [ "$AUTO_NO" = true ]; then
  export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"
fi

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

# Usage: install_and_verify_packages "package1 package2 package3" "Package Category Name"
install_and_verify_packages() {
  local packages="$1"
  local category_name="${2:-packages}"
  
  echo "Installing $category_name..."
  
  local pkg_array
  read -ra pkg_array <<< "$packages"
  
  if ! apt update -y; then
    echo "❌ ERROR: Failed to update apt package list"
    return 1
  fi

  if ! apt-get check >/dev/null 2>&1; then
    echo "⚠️  Detected broken package dependencies. Attempting to repair with 'apt --fix-broken install'..."
    if ! apt --fix-broken install -y; then
      echo "❌ ERROR: Failed to repair broken package dependencies."
      echo "Please resolve them manually (e.g. 'sudo apt --fix-broken install') and re-run this script."
      return 1
    fi
    echo "✅ Broken package dependencies repaired."
  fi
  
  if ! apt install -y "${pkg_array[@]}"; then
    echo "❌ ERROR: Failed to install $category_name"
    return 1
  fi
  
  echo "Verifying $category_name installation..."
  local missing_packages=()
  
  for pkg in "${pkg_array[@]}"; do
    if command -v "$pkg" >/dev/null 2>&1; then
      continue
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
  local system_packages="curl wget libxml2 git software-properties-common vulkan-tools libportaudio2 unzip jq"
  
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
  
  if [ "$AUTO_NO" = true ]; then
    echo "Auto-skipping driver installation (-n flag set)."
    echo ""
    echo "⚠️  Driver installation skipped."
    echo ""
    echo "You can manually install drivers later by running:"
    echo "sudo bash -c \"\$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)\""
    echo ""
    return 0
  elif [ "$AUTO_YES" = false ]; then
    if [ ! -t 0 ]; then
      echo "❌ ERROR: No TTY to ask about the driver installation."
      echo "   Re-run with -y (install the drivers) or -n (skip them)."
      return 1
    fi
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
    echo "Auto-accepting driver installation (-y flag set)..."
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
  
  rm -f "$driver_script"
  cd "$original_dir" || {
    echo "❌ ERROR: Failed to return to original directory: $original_dir"
    return 1
  }
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
  
  install_drivers || exit 1
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
  echo "Next step: run ./setup.sh to pick the llama.cpp backend (SYCL or Vulkan)"
  echo "and download the matching binaries."
  echo ""
}

main
