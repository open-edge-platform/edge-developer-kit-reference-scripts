#!/bin/bash

# Main Intel Platform Installer
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

#
# ----------------------------------------------------------------------------
# Restart handling (issues #986 and #987)
# ----------------------------------------------------------------------------
# Two related problems, fixed together because they interact.
#
# #987: reboot messages were scattered across three scripts in three registers
# ("required", "recommended", "may be required"), and the closing line printed
# on every run whether or not anything had changed. Printing it unconditionally
# teaches users to ignore it. Ubuntu already has a convention for this,
# /run/reboot-required, which the kernel package creates automatically, with
# reasons in /run/reboot-required.pkgs. Each installer now records why, and one
# banner is shown at the end, only when a restart is genuinely needed.
#
# #986: the installer now records restart requirements once, then lets the
# component installers decide whether a reboot is needed. GPU/NPU steps may
# request a restart, but the main flow should not hardcode a specific kernel
# series or duplicate that policy.
#
# DEVKIT_AUTO_INSTALL=1 therefore installs everything in one pass, defers
# verification, RESTARTS THE MACHINE, and prints the summary on the next boot.
# In that mode the #987 banner is suppressed: telling someone to reboot
# manually and then rebooting for them would be contradictory.
#
#   sudo DEVKIT_AUTO_INSTALL=1 ./main_installer.sh
REBOOT_REQUIRED_FILE="/run/reboot-required"
REBOOT_REQUIRED_REASONS="/run/reboot-required.pkgs"
export REBOOT_REQUIRED_FILE REBOOT_REQUIRED_REASONS

REBOOT_MARKER_DIR="/var/lib/intel-devkit"
REBOOT_MARKER_FILE="${REBOOT_MARKER_DIR}/pending-reboot.boot_id"
export REBOOT_MARKER_FILE

DEVKIT_AUTO_INSTALL="${DEVKIT_AUTO_INSTALL:-0}"
export DEVKIT_AUTO_INSTALL

readonly REBOOT_GRACE_SECONDS=10

SUMMARY_STATE_DIR="/var/lib/intel-devkit"
SUMMARY_UNIT="intel-devkit-summary.service"
SUMMARY_UNIT_PATH="/etc/systemd/system/${SUMMARY_UNIT}"
SUMMARY_WRAPPER="${SUMMARY_STATE_DIR}/summary.sh"

# Fail fast, treat unset variables as errors, and catch pipeline failures
set -euo pipefail

# Script directory (where main_installer.sh is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Status indicators - using ASCII for better compatibility
S_ERROR="[ERROR]"
S_VALID="[✓]"
S_WARNING="[!]"

# Colours used by the restart banners. Defined here because set -u makes an
# unset reference fatal, and empty when the output is not a terminal so the
# escape codes do not end up in the log file.
if [ -t 1 ]; then
    YELLOW='\033[1;33m'
    GREEN='\033[0;32m'
    NC='\033[0m'
else
    YELLOW=''
    GREEN=''
    NC=''
fi

# Error handler: reports failing command and line number
error_trap() {
    local exit_code=$?
    local cmd="${BASH_COMMAND:-unknown}"
    local line_no=${BASH_LINENO[0]:-?}
    echo "${S_ERROR} Script exited with code ${exit_code} at line ${line_no} (command: ${cmd})"
    echo "See log for details: ${LOG_FILE:-/var/log/intel-platform-installer.log}"
    exit ${exit_code}
}

trap 'error_trap' ERR
trap 'echo "Script interrupted"; exit 130' INT TERM

# Default values
export INSTALL_CAMERA=false
export INSTALL_OPENVINO=false
export TELEMETRY_CONSENT=""

# Optional extras. Nothing here is installed unless the user asks for it,
# either through the selection menu or --with-extras=<list>.
INSTALL_DOCKER=false
INSTALL_QMASSA=false
INSTALL_DLSTREAMER=false

# How extras were requested: unset, menu, list or none.
EXTRAS_MODE="unset"
EXTRAS_LIST=""

# Outcome tracking, reported in the closing notice.
EXTRAS_INSTALLED=()
EXTRAS_FAILED=()

# Log file configuration
LOG_FILE="/var/log/intel-platform-installer.log"

current_boot_id() {
    cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "unknown"
}

mark_reboot_pending() {
    mkdir -p "$REBOOT_MARKER_DIR" 2>/dev/null || return 0
    current_boot_id > "$REBOOT_MARKER_FILE" 2>/dev/null || true
}

clear_reboot_pending() {
    rm -f "$REBOOT_MARKER_FILE" 2>/dev/null || true
}

is_post_reboot_pass() {
    [ -f "$REBOOT_MARKER_FILE" ] || return 1
    local marker_boot_id current_id
    marker_boot_id=$(cat "$REBOOT_MARKER_FILE" 2>/dev/null || echo "")
    current_id=$(current_boot_id)
    [ -n "$marker_boot_id" ] && [ "$marker_boot_id" != "$current_id" ]
}

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
    echo "Usage: sudo ./main_installer.sh [options]"
    echo ""
    echo "Drivers and OpenVINO are always installed. Optional extras are not."
    echo ""
    echo "Options:"
    echo "  --with-extras           Choose optional components from a menu"
    echo "  --with-extras=<list>    Install the listed components without asking"
    echo "  --no-extras             Skip the menu and install no extras"
    echo "  --telemetry=yes|no      Answer the telemetry question without prompting"
    echo "  -h, --help              Show this help"
    echo ""
    echo "Components accepted by --with-extras:"
    echo "  docker      Docker Engine, with the Compose and Buildx plugins"
    echo "  qmassa      Terminal Intel GPU usage monitor"
    echo "  dlstreamer  Intel DL Streamer, GStreamer media analytics elements"
    echo "  all         Every component above"
    echo "  none        No components, same as --no-extras"
    echo ""
    echo "Environment:"
    echo "  DEVKIT_AUTO_INSTALL=1   Unattended mode. Installs everything in a single"
    echo "                          pass even when the kernel must be replaced, then"
    echo "                          RESTARTS THE SYSTEM and prints the verification"
    echo "                          summary automatically on the next boot."
    echo "                          Default: off (two reboots, run the script twice)."
    echo ""
    echo "Examples:"
    echo "  sudo ./main_installer.sh"
    echo "      Drivers and OpenVINO. On a terminal you are asked about extras."
    echo ""
    echo "  sudo ./main_installer.sh --with-extras=docker"
    echo "      Adds Docker, no prompt. Suitable for scripted and CI runs."
    echo ""
    echo "  sudo ./main_installer.sh --with-extras=all"
    echo "      Adds every optional component, no prompt."
    echo ""
    echo "  sudo DLSTREAMER_VERSION=2026.1.0 ./main_installer.sh --with-extras=dlstreamer"
    echo "      Pins the DL Streamer release instead of taking the latest."
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
    local REPO_OWNER="open-edge-platform"
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
        "dlstreamer_installer.sh"
    )
    
    # Add telemetry scripts if user consented
    local ALL_SCRIPTS=("${REQUIRED_SCRIPTS[@]}")
    if [ "$TELEMETRY_CONSENT" = "yes" ]; then
        ALL_SCRIPTS+=("system_info.py" "telemetry.py")
        echo "$S_VALID Including telemetry scripts (user consented)"
    else
        echo "$S_VALID Skipping telemetry scripts (user declined or not set)"
    fi

    # Download scripts.
    # Only fetch a script that is not already present. This keeps the one-line
    # install working (nothing on disk, everything is downloaded) while a run
    # from a clone uses its own checked-out scripts instead of having them
    # overwritten by the copies on the remote branch. Set DEVKIT_FORCE_DOWNLOAD=1
    # to always pull the remote copy over any local one.
    apt update
    apt install -y curl
    mkdir -p "$DOWNLOAD_DIR"
    for script in "${ALL_SCRIPTS[@]}"; do
        local url="$BASE_URL/$script"
        local path="$DOWNLOAD_DIR/$script"

        if [ -f "$path" ] && [ "${DEVKIT_FORCE_DOWNLOAD:-0}" != "1" ]; then
            echo "Using local: $script"
            continue
        fi

        if curl -fsSL "$url" -o "$path"; then
            echo "Downloaded: $script"
        else
            echo "$S_ERROR Failed to download $script"
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

    echo "$S_VALID Ubuntu 24.04 LTS detected"
}

# Install NPU drivers (NPU-capable platforms only)
install_npu_drivers() {
    # Explicit guard: Only install NPU drivers on NPU-capable platforms
    if ! is_npu_capable; then
        echo "$S_ERROR NPU drivers are only supported on NPU-capable platforms"
        echo "Current platform: $CPU_MODEL"
        echo "Skipping NPU driver installation"
            return 0
    fi
    
    echo "Installing NPU drivers for $(npu_platform_label) platform..."
    echo "$S_VALID NPU driver installation is supported on this $(npu_platform_label) platform"
    
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

    if [ -z "$lspci_output" ]; then
        echo "$S_WARNING No GPU devices detected"
        echo "GPU driver installation will be skipped"
        return 1
    fi

    echo "GPU devices detected:"
    echo "$lspci_output"

    # Enforce Intel vendor (8086) for GPU install; exit if non-Intel only
    if echo "$lspci_output" | grep -Fq "[8086:"; then
        echo "$S_VALID Intel (8086) GPU found - proceeding with Intel GPU driver installation"
        return 0
    else
        # A display device with no Intel vendor is normal on Xeon and other
        # server platforms, where the BMC provides the only VGA controller.
        # Skip the GPU step rather than aborting the whole install.
        echo "$S_WARNING No Intel (8086) GPU found among the detected devices"
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
            # Optional: post verification hook could go here
            return 0
        else
            # gpu_installer.sh already emitted detailed errors including
            # OpenCL verification failures. Provide consolidated high-level status and exit.
            echo "$S_ERROR GPU driver installation failed"
            echo "$S_WARNING GPU driver installation had issues"
            echo "$S_ERROR Exiting due to GPU installation failure"
            exit 1
        fi
    else
        echo "$S_WARNING Skipping GPU driver installation - no Intel GPU detected"
        echo "This is normal on Xeon and other platforms without an Intel GPU"
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
IS_WCL=false
PTL_PLATFORM=false

# Detect platform information
detect_platform() {
    echo "Detecting platform family..."
    local wcl_regex='^Intel\(R\) Core\(TM\) (3|5|7) 3[0-9]{2}[[:alpha:]]*([[:space:]]|$)'

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
            # For core family, detect if this is a WCL Core 3 300-series variant
            if [[ "$CPU_MODEL" =~ $wcl_regex ]]; then
                IS_WCL=true
            fi
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

# Check if WCL platform
is_wcl() {
    [ "$IS_WCL" = true ]
}

# Check if platform supports NPU installation
is_npu_capable() {
    if is_coreultra; then
        return 0
    fi

    if [ "$PLATFORM_FAMILY" = "core" ] && is_wcl; then
        return 0
    fi

    return 1
}

# Platform label for NPU-capable systems
npu_platform_label() {
    if is_coreultra; then
        echo "Core Ultra"
    elif is_wcl; then
        echo "Intel® Core™ 3 300-series"
    else
        echo "NPU-capable"
    fi
}

# Check if PTL platform
is_ptl_platform() {
    [ "$PTL_PLATFORM" = true ]
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

# ---------------------------------------------------------------------------
# Additional software: Docker and qmassa (issue #1005)
# Installed after the drivers so a failure here cannot block the baseline.
# ---------------------------------------------------------------------------
RUSTUP_INSTALLED_BY_US=0

# Configure Docker to use the proxy from the environment, if one is set.
# Two layers need it separately:
#   daemon  -> systemd drop-in, used by docker pull/push
#   client  -> ~/.docker/config.json, used by docker build and injected into containers
# https://docs.docker.com/engine/daemon/proxy/
configure_docker_proxy() {
    local http_p https_p no_p
    http_p="${HTTP_PROXY:-${http_proxy:-}}"
    https_p="${HTTPS_PROXY:-${https_proxy:-}}"
    no_p="${NO_PROXY:-${no_proxy:-}}"

    if [ -z "$http_p" ] && [ -z "$https_p" ]; then
        echo "$S_VALID No proxy set in the environment, skipping Docker proxy configuration"
        return 0
    fi

    echo "# Configuring Docker proxy from the environment..."

    # Always bypass the loopback interface so local registries keep working.
    case ",$no_p," in
        *,localhost,*) : ;;
        *) no_p="${no_p:+$no_p,}localhost,127.0.0.1,::1" ;;
    esac

    # systemd treats '%' as a specifier prefix, so a literal one must be doubled.
    local http_sd https_sd no_sd
    http_sd=${http_p//%/%%}
    https_sd=${https_p//%/%%}
    no_sd=${no_p//%/%%}

    mkdir -p /etc/systemd/system/docker.service.d
    {
        echo "[Service]"
        [ -n "$http_sd" ]  && echo "Environment=\"HTTP_PROXY=$http_sd\""
        [ -n "$https_sd" ] && echo "Environment=\"HTTPS_PROXY=$https_sd\""
        [ -n "$no_sd" ]    && echo "Environment=\"NO_PROXY=$no_sd\""
    } > /etc/systemd/system/docker.service.d/http-proxy.conf

    systemctl daemon-reload || true
    systemctl restart docker || true
    echo "$S_VALID Wrote /etc/systemd/system/docker.service.d/http-proxy.conf"

    # Client config, merged so any existing settings survive.
    local target_home target_user
    for target_user in root "${SUDO_USER:-}"; do
        [ -z "$target_user" ] && continue
        target_home=$(getent passwd "$target_user" | cut -d: -f6)
        [ -z "$target_home" ] && continue
        mkdir -p "$target_home/.docker"
        HTTP_P="$http_p" HTTPS_P="$https_p" NO_P="$no_p" \
        python3 - "$target_home/.docker/config.json" <<'PYEOF' || true
import json, os, sys
path = sys.argv[1]
try:
    with open(path) as fh:
        cfg = json.load(fh)
except Exception:
    cfg = {}
cfg.setdefault("proxies", {}).setdefault("default", {}).update({
    k: v for k, v in (
        ("httpProxy", os.environ.get("HTTP_P", "")),
        ("httpsProxy", os.environ.get("HTTPS_P", "")),
        ("noProxy", os.environ.get("NO_P", "")),
    ) if v
})
with open(path, "w") as fh:
    json.dump(cfg, fh, indent=2)
    fh.write("\n")
PYEOF
        chown -R "$target_user": "$target_home/.docker" 2>/dev/null || true
        echo "$S_VALID Wrote $target_home/.docker/config.json"
    done

    systemctl show --property=Environment docker 2>/dev/null | head -1 || true
}

# https://docs.docker.com/engine/install/ubuntu/
install_docker() {
    if command -v docker >/dev/null 2>&1; then
        echo "$S_VALID Docker already installed: $(docker --version 2>/dev/null || echo unknown)"
    else
        echo "# Installing Docker Engine and Compose..."

        # Distro packages conflict with Docker's own; remove any that are present.
        local conflicting
        conflicting=$(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc 2>/dev/null | cut -f1 || true)
        if [ -n "$conflicting" ]; then
            # shellcheck disable=SC2086
            DEBIAN_FRONTEND=noninteractive apt-get remove -y $conflicting || true
        fi

        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl

        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc

        local codename arch
        # shellcheck disable=SC1091
        codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
        arch=$(dpkg --print-architecture)

        tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF

        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        systemctl enable --now docker >/dev/null 2>&1 || true

        echo "$S_VALID Docker installed: $(docker --version 2>/dev/null || echo unknown)"
    fi

    # Compose ships as a plugin, invoked as 'docker compose'
    if docker compose version >/dev/null 2>&1; then
        echo "$S_VALID Docker Compose installed: $(docker compose version --short 2>/dev/null || echo unknown)"
    else
        DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || \
            echo "$S_WARNING Docker Compose plugin not installed"
    fi

    # Proxy must be configured before the first pull, and after the daemon exists
    configure_docker_proxy

    # The docker group is created by the package but has no members, so the
    # invoking user would still need sudo for every command.
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        usermod -aG docker "$SUDO_USER" || true
        echo "$S_VALID Added '$SUDO_USER' to the docker group"
        echo "$S_WARNING Log out and back in, or run 'newgrp docker', to use docker without sudo"
    fi
}

# https://github.com/ulissesf/qmassa - cargo is the recommended install route
install_qmassa() {
    if command -v qmassa >/dev/null 2>&1; then
        echo "$S_VALID qmassa already installed: $(qmassa --version 2>/dev/null || echo unknown)"
        return 0
    fi

    echo "# Installing qmassa (compiled from source)..."

    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        build-essential pkg-config libudev-dev curl ca-certificates

    # qmassa needs a newer Rust than Ubuntu 24.04 ships, so use rustup.
    if ! command -v cargo >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
            | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path
        RUSTUP_INSTALLED_BY_US=1
    fi

    # shellcheck disable=SC1090,SC1091
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

    if ! cargo install --locked --root /usr/local qmassa; then
        echo "$S_ERROR qmassa build failed"
        if [ "$RUSTUP_INSTALLED_BY_US" -eq 1 ]; then
            rustup self uninstall -y >/dev/null 2>&1 || true
        fi
        return 1
    fi

    # Reclaim the toolchain, but only if this script installed it.
    if [ "$RUSTUP_INSTALLED_BY_US" -eq 1 ]; then
        rustup self uninstall -y >/dev/null 2>&1 || true
        echo "$S_VALID Removed the temporary Rust toolchain"
    fi

    echo "$S_VALID qmassa installed: $(qmassa --version 2>/dev/null || echo unknown)"
    echo "$S_WARNING qmassa needs root, or membership of the video and render groups, to report all stats"
}

# Delegates to the standalone installer, which handles the Intel repositories,
# the OpenVINO version check and the system-wide environment. DLSTREAMER_VERSION
# passes through the environment if the caller set it.
install_dlstreamer() {
    if [ ! -f "$SCRIPT_DIR/dlstreamer_installer.sh" ]; then
        echo "$S_ERROR DL Streamer installer not found at $SCRIPT_DIR/dlstreamer_installer.sh"
        return 1
    fi

    echo "# Installing Intel DL Streamer..."

    if ! bash "$SCRIPT_DIR/dlstreamer_installer.sh"; then
        return 1
    fi

    echo "$S_VALID DL Streamer installed"
    echo "$S_WARNING Log out and back in so the DL Streamer environment is applied"
}

# ---------------------------------------------------------------------------
# Optional extras: selection
# ---------------------------------------------------------------------------

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --with-extras)
                EXTRAS_MODE="menu"
                ;;
            --with-extras=*)
                EXTRAS_MODE="list"
                EXTRAS_LIST="${1#*=}"
                ;;
            --no-extras)
                EXTRAS_MODE="none"
                ;;
            --telemetry=yes|--telemetry=y)
                export TELEMETRY_CONSENT="yes"
                ;;
            --telemetry=no|--telemetry=n)
                export TELEMETRY_CONSENT="no"
                ;;
            --telemetry)
                echo "$S_ERROR --telemetry requires a value: yes or no"
                exit 1
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "$S_ERROR Unknown option: $1"
                echo "Run './main_installer.sh --help' for the list of options."
                exit 1
                ;;
        esac
        shift
    done
}

# Turn a comma separated list into the per component decisions.
apply_extras_list() {
    local raw item
    raw="$1"

    local IFS=','
    for item in $raw; do
        case "$(echo "$item" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
            all)
                INSTALL_DOCKER=true
                INSTALL_QMASSA=true
                INSTALL_DLSTREAMER=true
                ;;
            docker)
                INSTALL_DOCKER=true
                ;;
            qmassa)
                INSTALL_QMASSA=true
                ;;
            dlstreamer)
                INSTALL_DLSTREAMER=true
                ;;
            none|"")
                ;;
            *)
                echo "$S_ERROR Unknown component: $item"
                echo "Valid components: docker, qmassa, dlstreamer, all, none"
                exit 1
                ;;
        esac
    done
}

# Plain prompt, used when whiptail is unavailable.
select_extras_text() {
    local reply=""

    echo ""
    echo "Optional components, none of them required:"
    echo "  docker      Docker Engine, with the Compose and Buildx plugins"
    echo "  qmassa      Terminal Intel GPU usage monitor"
    echo "  dlstreamer  Intel DL Streamer, GStreamer media analytics elements"
    echo ""
    read -r -p "Install which? [docker,qmassa,dlstreamer,all,none] (default none): " reply || reply=""

    if [ -n "$reply" ]; then
        apply_extras_list "$reply"
    fi
}

# Checklist menu. Runs before logging starts, so it has the real terminal.
select_extras_menu() {
    local choices="" status=0

    if ! command -v whiptail >/dev/null 2>&1; then
        select_extras_text
        return 0
    fi

    # whiptail draws on stderr and returns its result on stdout, hence the
    # descriptor swap. Cancel and Escape exit non-zero, which must not reach
    # the ERR trap, so the status is captured rather than allowed to propagate.
    set +e
    choices=$(whiptail --title "Optional components" \
        --checklist "\nNone of these are required. Space selects, Enter confirms.\n" \
        14 76 3 \
        "docker" "Docker Engine, Compose and Buildx plugins" OFF \
        "qmassa" "Terminal Intel GPU usage monitor" OFF \
        "dlstreamer" "DL Streamer media analytics elements" OFF \
        3>&1 1>&2 2>&3)
    status=$?
    set -e

    if [ "$status" -ne 0 ]; then
        return 0
    fi

    case "$choices" in
        *docker*) INSTALL_DOCKER=true ;;
    esac
    case "$choices" in
        *qmassa*) INSTALL_QMASSA=true ;;
    esac
    case "$choices" in
        *dlstreamer*) INSTALL_DLSTREAMER=true ;;
    esac
}

# Decide what to install. Called before setup_logging so that any prompt
# reaches the terminal instead of the tee pipeline.
resolve_extras() {
    case "$EXTRAS_MODE" in
        list)
            apply_extras_list "$EXTRAS_LIST"
            ;;
        none)
            ;;
        menu)
            if [ -t 0 ] && [ -t 1 ]; then
                select_extras_menu
            else
                echo "$S_ERROR --with-extras needs a terminal."
                echo "In scripts use --with-extras=docker,qmassa instead."
                exit 1
            fi
            ;;
        *)
            # No flag given: install nothing, the same as --no-extras. The menu
            # is shown only when the user explicitly asks with --with-extras.
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Optional extras: installation and reporting
# ---------------------------------------------------------------------------

install_additional_software() {
    if [ "$INSTALL_DOCKER" = false ] && [ "$INSTALL_QMASSA" = false ] \
       && [ "$INSTALL_DLSTREAMER" = false ]; then
        return 0
    fi

    echo ""
    echo "========================================================================"
    echo "# ADDITIONAL SOFTWARE INSTALLATION"
    echo "========================================================================"

    if [ "$INSTALL_DOCKER" = true ]; then
        if install_docker; then
            EXTRAS_INSTALLED+=("Docker Engine")
        else
            echo "$S_WARNING Docker installation had issues"
            EXTRAS_FAILED+=("Docker Engine")
        fi
    fi

    if [ "$INSTALL_QMASSA" = true ]; then
        if install_qmassa; then
            EXTRAS_INSTALLED+=("qmassa")
        else
            echo "$S_WARNING qmassa installation had issues"
            EXTRAS_FAILED+=("qmassa")
        fi
    fi

    if [ "$INSTALL_DLSTREAMER" = true ]; then
        if install_dlstreamer; then
            EXTRAS_INSTALLED+=("DL Streamer")
        else
            echo "$S_WARNING DL Streamer installation had issues"
            EXTRAS_FAILED+=("DL Streamer")
        fi
    fi

    return 0
}

# Closing note. A selected component that failed is stated plainly rather than
# left in the scrollback, and anything not installed is advertised once.
extras_notice() {
    local item

    if [ ${#EXTRAS_FAILED[@]} -gt 0 ]; then
        echo ""
        for item in "${EXTRAS_FAILED[@]}"; do
            echo "$S_WARNING Selected but not installed: $item"
        done
        echo "    See $LOG_FILE for the reason."
    fi

    if [ "$INSTALL_DOCKER" = true ] && [ "$INSTALL_QMASSA" = true ] \
       && [ "$INSTALL_DLSTREAMER" = true ]; then
        return 0
    fi

    echo ""
    echo "Optional components not installed:"
    if [ "$INSTALL_DOCKER" = false ]; then
        echo "  docker      Docker Engine, with the Compose and Buildx plugins"
    fi
    if [ "$INSTALL_QMASSA" = false ]; then
        echo "  qmassa      Terminal Intel GPU usage monitor"
    fi
    if [ "$INSTALL_DLSTREAMER" = false ]; then
        echo "  dlstreamer  Intel DL Streamer, GStreamer media analytics elements"
    fi
    echo ""
    echo "  Add them at any time:"
    echo "    sudo ./main_installer.sh --with-extras"
}

# Record that a restart is needed, and why. Safe to call repeatedly. (#987)
flag_reboot_required() {
    local reason="$1"
    echo "*** System restart required ***" > "$REBOOT_REQUIRED_FILE" 2>/dev/null || return 0
    if ! grep -qxF "$reason" "$REBOOT_REQUIRED_REASONS" 2>/dev/null; then
        echo "$reason" >> "$REBOOT_REQUIRED_REASONS" 2>/dev/null || true
    fi
}

# One prominent, conditional banner. Printing nothing when no restart is needed
# is what makes the banner mean something when it appears. (#987)
print_reboot_banner() {
    mark_reboot_pending

    if [ ! -f "$REBOOT_REQUIRED_FILE" ]; then
        echo ""
        echo "$S_VALID No restart required. The platform is ready to use."
        return 0
    fi

    echo ""
    echo -e "${YELLOW}########################################################################${NC}"
    echo -e "${YELLOW}#                                                                      #${NC}"
    echo -e "${YELLOW}#                   RESTART REQUIRED TO FINISH SETUP                   #${NC}"
    echo -e "${YELLOW}#                                                                      #${NC}"
    echo -e "${YELLOW}########################################################################${NC}"
    echo ""
    echo "  The following will not take effect until the system restarts:"
    echo ""
    if [ -s "$REBOOT_REQUIRED_REASONS" ]; then
        sed 's/^/    - /' "$REBOOT_REQUIRED_REASONS"
    else
        echo "    - Package updates that require a restart"
    fi
    echo ""
    echo "  Running kernel: $(uname -r)"
    echo ""
    echo -e "  Restart now with:   ${GREEN}sudo reboot${NC}"
    echo ""
    echo "  After restarting, confirm with:"
    echo "    sudo $SCRIPT_DIR/print_summary_table.sh"
    echo ""
    echo -e "${YELLOW}########################################################################${NC}"
}

# Remove any summary unit left over from an earlier run (#986)
disarm_summary() {
    [ -f "$SUMMARY_UNIT_PATH" ] || return 0
    systemctl disable "$SUMMARY_UNIT" >/dev/null 2>&1 || true
    rm -f "$SUMMARY_UNIT_PATH" "$SUMMARY_WRAPPER"
    systemctl daemon-reload >/dev/null 2>&1 || true
}

# Print the platform summary automatically on the next boot, so the user does
# not have to run it by hand. It only reports; it installs nothing. The wrapper
# disarms itself before doing any work, so a failure cannot repeat. (#986)
arm_summary_after_reboot() {
    local summary_script="${SCRIPT_DIR}/print_summary_table.sh"
    [ -f "$summary_script" ] || return 1

    mkdir -p "$SUMMARY_STATE_DIR"

    cat > "$SUMMARY_WRAPPER" <<WRAPPER_EOF
#!/bin/bash
# Disarm first: this must never run twice
systemctl disable ${SUMMARY_UNIT} >/dev/null 2>&1 || true
rm -f ${SUMMARY_UNIT_PATH}
systemctl daemon-reload >/dev/null 2>&1 || true

DEVKIT_LOG=${LOG_FILE:-/var/log/intel-platform-installer.log}
echo "" >> "\$DEVKIT_LOG"
echo "===== Post-reboot verification \$(date '+%Y-%m-%d %H:%M:%S') =====" >> "\$DEVKIT_LOG"
bash ${summary_script} >> "\$DEVKIT_LOG" 2>&1
WRAPPER_EOF
    chmod 0755 "$SUMMARY_WRAPPER"

    cat > "$SUMMARY_UNIT_PATH" <<UNIT_EOF
[Unit]
Description=Intel devkit post-reboot verification summary
After=multi-user.target

[Service]
Type=oneshot
ExecStart=${SUMMARY_WRAPPER}

[Install]
WantedBy=multi-user.target
UNIT_EOF

    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl enable "$SUMMARY_UNIT" >/dev/null 2>&1 || { rm -f "$SUMMARY_UNIT_PATH" "$SUMMARY_WRAPPER"; return 1; }
    return 0
}

# Restart the machine, after a short grace period so it can be interrupted (#986)
auto_reboot() {
    mark_reboot_pending

    echo ""
    echo -e "${YELLOW}########################################################################${NC}"
    echo -e "${YELLOW}#           THIS SYSTEM WILL RESTART TO FINISH SETUP                   #${NC}"
    echo -e "${YELLOW}########################################################################${NC}"
    echo ""
    if [ -s "$REBOOT_REQUIRED_REASONS" ]; then
        echo "  Applying:"
        sed 's/^/    - /' "$REBOOT_REQUIRED_REASONS"
        echo ""
    fi
    echo "  Press Ctrl+C to cancel and restart it yourself later."
    echo ""
    local i="$REBOOT_GRACE_SECONDS"
    while [ "$i" -gt 0 ]; do
        printf "\r  restarting in %2ds ... " "$i"
        sleep 1
        i=$((i - 1))
    done
    printf "\r  restarting now       \n"
    systemctl reboot || reboot
}

# Main execution flow
# Telemetry consent function
ask_telemetry_consent() {
    # Skip prompt if consent was already provided via --telemetry argument
    if [ -n "${TELEMETRY_CONSENT:-}" ]; then
        if [ "$TELEMETRY_CONSENT" = "yes" ]; then
            echo "$S_VALID Telemetry data collection enabled (via --telemetry flag)"
        else
            echo "$S_VALID Telemetry data collection disabled (via --telemetry flag)"
        fi
        return 0
    fi

    echo ""
    echo "======================================================================"
    echo "# TELEMETRY DATA COLLECTION"
    echo "======================================================================"
    echo "This installer can collect anonymous system information to help improve"
    echo "Intel®'s development tools and platform support. The collected data includes:"
    echo ""
    echo "• System information (OS, CPU, GPU models)"
    echo "• Motherboard information (manufacturer, product name)"
    echo "• Geographic location (country/region only)"
    echo "• Installation date"
    echo ""
    echo "No personal information, file contents, or sensitive data is collected."
    echo "Data transmission is secure and anonymous."
    echo ""
    echo "Note: No response within 5 seconds defaults to 'No' automatically."
    echo ""
    
    while true; do
        local secs=5
        response=""
        while [ "$secs" -gt 0 ]; do
            printf "\rDo you consent to anonymous telemetry data collection? [y/N] (auto-No in %ds): " "$secs"
            if IFS= read -t 1 -r response; then
                printf "\n"
                break
            fi
            secs=$((secs - 1))
        done
        if [ "$secs" -eq 0 ]; then
            printf "\n"
            response=""
        fi

        # Default to no if user just presses enter or timed out
        if [ -z "$response" ]; then
            response="n"
        fi
        
        case "$response" in
            [Yy]|[Yy][Ee][Ss])
                export TELEMETRY_CONSENT="yes"
                echo "$S_VALID Telemetry data collection enabled"
                echo ""
                return 0
                ;;
            [Nn]|[Nn][Oo])
                export TELEMETRY_CONSENT="no"
                echo "$S_VALID Telemetry data collection disabled"
                echo "$S_WARNING Installation will continue without data collection"
                echo ""
                return 0
                ;;
            *)
                echo "Please answer yes (y) or no (n)"
                ;;
        esac
    done
}

# Send telemetry data if consent was given
send_telemetry_data() {
    if [ "$TELEMETRY_CONSENT" = "yes" ]; then
        echo "$S_VALID Sending anonymous telemetry data..."
        
        # Check if Python3 and both required scripts exist
        if command -v python3 >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/telemetry.py" ] && [ -f "$SCRIPT_DIR/system_info.py" ]; then
            # Run the telemetry script and capture the result
            if (cd "$SCRIPT_DIR" && python3 telemetry.py 2>/dev/null); then
                echo "$S_VALID Telemetry data sent successfully"
            else
                echo "$S_WARNING Telemetry transmission failed (network or service issue)"
            fi
        else
            echo "$S_WARNING Telemetry scripts not available, skipping data collection"
        fi
    else
        echo "$S_VALID Skipping telemetry data collection (user declined)"
    fi
}

main() {
    parse_args "$@"
    check_privileges

    if is_post_reboot_pass; then
        export DEVKIT_POST_REBOOT_PASS=1
    fi

    # Ask before logging is redirected through tee, so the menu reaches the
    # terminal, and before the drivers run, so the machine can be left alone.
    resolve_extras

    setup_logging "$@"

    # Clear anything armed by a previous run
    disarm_summary
    
    echo "Intel Platform Installer"
    echo "========================"
    echo ""
    if [ "$INSTALL_DOCKER" = true ]; then
        echo "$S_VALID Optional component selected: docker"
    fi
    if [ "$INSTALL_QMASSA" = true ]; then
        echo "$S_VALID Optional component selected: qmassa"
    fi
    if [ "$INSTALL_DLSTREAMER" = true ]; then
        echo "$S_VALID Optional component selected: dlstreamer"
    fi

    # Ask for telemetry consent (skipped if --telemetry flag was provided)
    ask_telemetry_consent

    download_scripts
    # 1. Detect platform first (needed for kernel policy in verify step)
    echo "# Detecting platform..."
    detect_platform
    echo ""

    # 2. Verify Ubuntu version
    verify_ubuntu_24
    echo ""

    # 3. Install essential development tools
    install_build_essentials
    echo ""
    
    # 4. Platform Installation Flow
    echo "# Platform Installation Flow..."
    echo "$S_VALID Platform detected: $CPU_MODEL"
    
    # Determine platform family and execute appropriate flow
    if is_npu_capable; then
        echo ""
        echo "========================================================================"
        echo "# NPU-CAPABLE PLATFORM INSTALLATION"
        echo "========================================================================"
        echo "Platform: $(npu_platform_label) CPU"
        echo "Components: GPU Drivers + NPU Drivers + OpenVINO"
        echo "NPU Support: Available and will be installed"
        echo ""
        
        # Install GPU drivers (will check for GPU presence). Any failure will exit.
        install_gpu_drivers
        
        # Install NPU drivers (NPU-capable platforms only)
        install_npu_drivers || echo "$S_WARNING NPU driver installation had issues"
        
        # Install OpenVINO with error handling
        if ! install_openvino; then
            echo "$S_ERROR $(npu_platform_label) platform setup incomplete due to OpenVINO installation failure"
            echo "You may retry OpenVINO installation manually: bash $SCRIPT_DIR/openvino_installer.sh"
        fi
        
    else
        # Any platform that is not NPU-capable
        echo ""
        echo "========================================================================"
        echo "# STANDARD INTEL PLATFORM INSTALLATION"
        echo "========================================================================"
        echo "Platform: $CPU_MODEL (Xeon/Atom/Core)"
        echo "Components: GPU Drivers (if GPU present) + OpenVINO"
        echo "NPU Support: Not available on this platform"
        echo ""
        
        # Install GPU drivers (will check for GPU presence). Any failure will exit.
        install_gpu_drivers
        
        # Install OpenVINO with error handling
        if ! install_openvino; then
            echo "$S_ERROR Platform setup incomplete due to OpenVINO installation failure"
            echo "You may retry OpenVINO installation manually: bash $SCRIPT_DIR/openvino_installer.sh"
        fi
    fi
    
    # Install additional software (Docker, Docker Compose, qmassa)
    install_additional_software

    # Run installation summary
    summary
    # Report on the optional components
    extras_notice

    # Send telemetry data if consent was given
    send_telemetry_data
   
    # Log completion
    echo ""
    echo "========================================================================"
    echo "Installation completed: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Log file saved: $LOG_FILE"
    echo "========================================================================"

    if [ "${DEVKIT_POST_REBOOT_PASS:-0}" = "1" ]; then
        clear_reboot_pending
    fi

    # If any component requested a restart, unattended mode reboots once here
    # and the summary is appended after boot. Otherwise show the conditional
    # banner only when a restart is actually required.
    if [ -f "$REBOOT_REQUIRED_FILE" ] && [ "$DEVKIT_AUTO_INSTALL" = "1" ]; then
        if arm_summary_after_reboot; then
            echo "Verification runs automatically after the restart and is appended to"
            echo "${LOG_FILE:-/var/log/intel-platform-installer.log}"
        fi
        auto_reboot
    else
        print_reboot_banner
    fi
}

# Execute main function with all arguments
main "$@"
