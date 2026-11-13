#!/bin/bash

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

AUTO_YES=false
AUTO_NO=false
PYTHON_BIN=""

print_usage() {
  cat <<EOF
Usage: sudo bash $0 [-y|--yes | -n|--no]

Install system dependencies and optionally the Intel GPU/NPU drivers.
In non-interactive use, choose -y to install drivers or -n to skip them.

Options:
  -y, --yes  Install GPU/NPU drivers without prompting.
  -n, --no   Skip GPU/NPU driver installation.
  -h, --help Show this help and exit.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) AUTO_YES=true ;;
    -n|--no) AUTO_NO=true ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$AUTO_YES" = true ] && [ "$AUTO_NO" = true ]; then
  echo "Options -y/--yes and -n/--no cannot be used together." >&2
  exit 2
fi

if [ ! -t 0 ] && [ "$AUTO_YES" = false ] && [ "$AUTO_NO" = false ]; then
  echo "Non-interactive use requires -y/--yes or -n/--no." >&2
  exit 2
fi

if [ "$AUTO_YES" = true ] || [ "$AUTO_NO" = true ]; then
  export DEBIAN_FRONTEND=noninteractive
fi

echo "Setting up system-level dependencies (requires sudo)..."

install_packages(){
    local PACKAGES=("$@")
    local INSTALL_REQUIRED=0
    for PACKAGE in "${PACKAGES[@]}"; do
        INSTALLED_VERSION=$(dpkg-query -W -f='${Version}' "$PACKAGE" 2>/dev/null || true)
        LATEST_VERSION=$(apt-cache policy "$PACKAGE" | grep Candidate | awk '{print $2}')
        
        if [ -z "$INSTALLED_VERSION" ] || [ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]; then
            echo "$PACKAGE is not installed or not the latest version."
            INSTALL_REQUIRED=1
        fi
    done
    if [ $INSTALL_REQUIRED -eq 1 ]; then
      if ! apt-get install -y "${PACKAGES[@]}"; then
        echo "[ERROR] Failed to install required packages: ${PACKAGES[*]}" >&2
        return 1
      fi
    fi
}

verify_dependencies(){
    echo -e "# Verifying dependencies"
  if ! apt-get update -y; then
    echo "[ERROR] Failed to update package lists." >&2
    return 1
  fi

  local python_version=""
  local candidate_version candidate
  for candidate_version in 3.14 3.13 3.12; do
    candidate=$(apt-cache policy "python${candidate_version}" | awk '/Candidate:/ {print $2}')
    if [ -n "$candidate" ] && [ "$candidate" != "(none)" ]; then
      python_version="$candidate_version"
      break
    fi
  done
  if [ -z "$python_version" ]; then
    echo "[ERROR] No Python 3.12, 3.13, or 3.14 package is available from the configured APT sources." >&2
    return 1
  fi

  PYTHON_BIN="python${python_version}"
    DEPENDENCIES_PACKAGES=(
        software-properties-common
    "$PYTHON_BIN"
    "${PYTHON_BIN}-venv"
    "${PYTHON_BIN}-dev"
        curl
        git
        wget        
        libportaudio2
    )
    if ! install_packages "${DEPENDENCIES_PACKAGES[@]}"; then
      echo "[ERROR] Failed to install system dependencies." >&2
      return 1
    fi
    if ! "$PYTHON_BIN" -c 'import sys; print("Python " + ".".join(map(str, sys.version_info[:3]))); sys.exit(0 if sys.version_info[:2] in ((3, 12), (3, 13), (3, 14)) else 1)'; then
      echo "[ERROR] Installed $PYTHON_BIN is outside the supported Python 3.12-3.14 range." >&2
      return 1
    fi
    echo "Dependencies installed."
}

if [ "$(id -u)" -ne 0 ]; then
  echo "This script requires sudo privileges. Please run with sudo."
  exit 1
fi


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
      AUTO_NO=true
      echo ""
      echo "⚠️  Driver installation skipped."
      echo ""
      echo "You can manually install drivers later by running:"
      echo "sudo bash -c \"\$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)\""
      echo ""
      return 0
    fi
    AUTO_YES=true
    export DEBIAN_FRONTEND=noninteractive
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
  
  if ! DEVKIT_AUTO_INSTALL=1 "$driver_script"; then
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
  
  verify_dependencies || exit 1
  echo ""  
  
  install_drivers || exit 1
  echo ""

  echo "=========================================="
  echo "✅ All requested setup steps completed successfully!"
  echo "=========================================="
  echo ""
  echo "System-level setup completed successfully."
  echo "Summary:"
  echo "  ✅ System packages (Python, curl, Git, wget, PortAudio)"
  if [ "$AUTO_NO" = true ]; then
    echo "  ⚠️ GPU/NPU driver installation skipped"
  else
    echo "  ✅ GPU drivers installed and verified"
    echo "  ✅ NPU drivers installed and verified"
    echo "  ✅ OpenVINO runtime compatibility confirmed"
  fi
  echo ""
  echo "Next step: run PYTHON=$PYTHON_BIN ./install_dependencies.sh to install the application dependencies"
  echo ""
}

main