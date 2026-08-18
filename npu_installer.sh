#!/bin/bash

# NPU (Neural Processing Unit) Installer for Core Ultra platforms
# Installs Intel NPU drivers with Level Zero support
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Version Management:
#
# The driver is pinned to a validated release by default. The pinned path
# builds the download URL directly and never contacts api.github.com, which is
# rate limited to 60 requests/hour per source IP. Behind a shared NAT or
# corporate proxy that quota is easily exhausted by other machines, which made
# installation fail intermittently and undiagnosably. See issue #1038.
#
# Note that only the metadata API is rate limited. The release *download* host
# is not, so the pinned path keeps working even when the API is exhausted.
#
# This mirrors main_installer.sh, which pins the kernel rather than resolving
# the newest one.
#
# Overrides:
#   NPU_VERSION=latest          resolve the newest release (needs the API)
#   NPU_VERSION + NPU_BUILD_ID  install a specific release, no API call
#   NPU_ASSET_URL               full tar.gz URL, no API call
#   GITHUB_TOKEN                raises the API quota to 5000/hour when used
#
# Releases: https://github.com/intel/linux-npu-driver/releases
#
# Usage:
#   sudo ./npu_installer.sh
#   sudo NPU_VERSION=latest ./npu_installer.sh
#   sudo NPU_VERSION=1.32.1 NPU_BUILD_ID=20260422-24767473183 ./npu_installer.sh

# Validated release, updated deliberately rather than tracking upstream.
readonly NPU_PINNED_VERSION="1.33.0"
readonly NPU_PINNED_BUILD_ID="20260529-26625960453"

NPU_VERSION="${NPU_VERSION:-}"
NPU_BUILD_ID="${NPU_BUILD_ID:-}"
NPU_ASSET_URL="${NPU_ASSET_URL:-}"

# Apply the pin unless the caller asked for something else
if [ -z "$NPU_ASSET_URL" ] && [ -z "$NPU_VERSION" ]; then
   NPU_VERSION="$NPU_PINNED_VERSION"
   NPU_BUILD_ID="$NPU_PINNED_BUILD_ID"
fi

log_success() {
   echo "$S_VALID $1"
}

# Resolve latest release and asset URL from GitHub (no jq required)
GITHUB_API_ERROR=""

resolve_latest_release() {
   local json url tag asset_name http_code body hdr
   local -a auth=()
   [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

   body=$(mktemp); hdr="${body}.hdr"
   http_code=$(curl -sS -L -o "$body" -D "$hdr" -w '%{http_code}' \
      --connect-timeout 10 --max-time 30 \
      -H "Accept: application/vnd.github+json" "${auth[@]}" \
      https://api.github.com/repos/intel/linux-npu-driver/releases/latest 2>/dev/null) || http_code="000"

   case "$http_code" in
      200) json=$(cat "$body") ;;
      403|429)
         if [ "$(grep -i '^x-ratelimit-remaining:' "$hdr" 2>/dev/null | tr -d '\r' | awk '{print $2}')" = "0" ]; then
            GITHUB_API_ERROR="GitHub API rate limit exhausted for this source IP"
         else
            GITHUB_API_ERROR="GitHub API returned HTTP $http_code"
         fi
         ;;
      000) GITHUB_API_ERROR="Cannot reach api.github.com (network or proxy)" ;;
      *)   GITHUB_API_ERROR="GitHub API returned HTTP $http_code" ;;
   esac
   rm -f "$body" "$hdr"

   if [ -n "$json" ]; then
      tag=$(echo "$json" | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/' )
      url=$(echo "$json" | grep '"browser_download_url"' | grep -E 'tar\.gz' | grep -E 'ubuntu2404|ubuntu24\.04|ubuntu24' | head -1 | sed -E 's/.*"(https:[^"]+)".*/\1/')
      if [ -z "$url" ]; then
         # Fallback to any tar.gz if ubuntu-specific not found
         url=$(echo "$json" | grep '"browser_download_url"' | grep -E 'tar\.gz' | head -1 | sed -E 's/.*"(https:[^"]+)".*/\1/')
      fi
      if [ -n "$url" ]; then
         NPU_ASSET_URL="$url"
         NPU_VERSION="$tag"
         asset_name=$(basename "$url")
         # Expected: linux-npu-driver-v<version>.<build>-<ubuntu>.tar.gz
         NPU_BUILD_ID=$(echo "$asset_name" | sed -E 's/^linux-npu-driver-v[^.]+\.([^-]+)-.*/\1/' )
         return 0
      fi
   fi
   return 1
}

# Derive/resolve versions honoring overrides
resolve_versions() {
   # If user provided a direct asset URL, prefer it
   if [ -n "${NPU_ASSET_URL:-}" ]; then
      local asset_name
      asset_name=$(basename "$NPU_ASSET_URL")
      NPU_VERSION=${NPU_VERSION:-$(echo "$asset_name" | sed -E 's/^linux-npu-driver-v([^\.]+)\..*/\1/')}
      NPU_BUILD_ID=${NPU_BUILD_ID:-$(echo "$asset_name" | sed -E 's/^linux-npu-driver-v[^.]+\.([^-]+)-.*/\1/')}
      return 0
   fi

   # If user provided version + build id, construct the URL
   if [ -n "${NPU_VERSION:-}" ] && [ -n "${NPU_BUILD_ID:-}" ]; then
      NPU_ASSET_URL="https://github.com/intel/linux-npu-driver/releases/download/v${NPU_VERSION}/linux-npu-driver-v${NPU_VERSION}.${NPU_BUILD_ID}-${UBUNTU_VERSION}.tar.gz"
      return 0
   fi

   # NPU_VERSION=latest explicitly opts in to the GitHub API
   if [ "$NPU_VERSION" = "latest" ]; then
      NPU_VERSION=""
      if resolve_latest_release; then
         return 0
      fi
      print_error "Unable to resolve the latest NPU release from GitHub"
      [ -n "${GITHUB_API_ERROR:-}" ] && print_error "  $GITHUB_API_ERROR"
      print_info "  api.github.com allows 60 requests/hour per source IP."
      print_info "  Retry without NPU_VERSION=latest to install the pinned"
      print_info "  release ${NPU_PINNED_VERSION}, which needs no API call, or set GITHUB_TOKEN."
      return 1
   fi

   print_error "Unable to resolve the NPU release"
   print_error "You can override via NPU_ASSET_URL or NPU_VERSION+NPU_BUILD_ID"
   return 1
}

# Auto-detect Ubuntu version
UBUNTU_VERSION=""
detect_ubuntu_version() {
   local ubuntu_ver
   ubuntu_ver=$(lsb_release -r | awk '{print $2}')
   
   case "$ubuntu_ver" in
      "24.04")
         UBUNTU_VERSION="ubuntu2404"
         ;;
      *)
         print_warning "Unsupported Ubuntu version: $ubuntu_ver"
         print_warning "This script only supports Ubuntu 24.04 LTS"
         print_error "Please upgrade to Ubuntu 24.04 LTS for NPU driver support"
         exit 1
         ;;
   esac
   
   print_info "Detected Ubuntu version: $ubuntu_ver -> $UBUNTU_VERSION"
}

# Simple version display function (replaces complex GitHub scraping)
display_version_info() {
   print_info "Using NPU Driver Version Information:"
   if [ -n "${NPU_ASSET_URL:-}" ]; then
      local asset_name
      asset_name=$(basename "$NPU_ASSET_URL")
      print_info "Asset: ${asset_name}"
   fi
   print_info "NPU Version: ${NPU_VERSION:-auto} | Build: ${NPU_BUILD_ID:-auto}"
   print_info "Ubuntu Package: ${UBUNTU_VERSION}"
   print_info ""
   if [ "${NPU_VERSION}.${NPU_BUILD_ID}" = "${NPU_PINNED_VERSION}.${NPU_PINNED_BUILD_ID}" ]; then
      print_info "Using the pinned validated release (no GitHub API call)."
      print_info "Override: NPU_VERSION=latest, or NPU_VERSION + NPU_BUILD_ID, or NPU_ASSET_URL."
   else
      print_info "Using an overridden release."
   fi
}

# Status indicators - using ASCII for better compatibility (conditional definition)
if [[ -z "$S_ERROR" ]]; then
    S_ERROR="[ERROR]"
fi
if [[ -z "$S_VALID" ]]; then
    S_VALID="[✓]"
fi
if [[ -z "$S_WARNING" ]]; then
    S_WARNING="[!]"
fi

# Colors for output (conditional definition)
if [[ -z "$RED" ]]; then
    RED='\033[0;31m'
fi
if [[ -z "$GREEN" ]]; then
    GREEN='\033[0;32m'
fi
if [[ -z "$YELLOW" ]]; then
    YELLOW='\033[1;33m'
fi
if [[ -z "$NC" ]]; then
    NC='\033[0m' # No Color
fi

# Print colored output (define only if not already defined)
if ! command -v print_error &> /dev/null; then
    print_error() { echo -e "${RED}${S_ERROR} $1${NC}"; }
fi
if ! command -v print_success &> /dev/null; then
    print_success() { echo -e "${GREEN}${S_VALID} $1${NC}"; }
fi
if ! command -v print_warning &> /dev/null; then
    print_warning() { echo -e "${YELLOW}${S_WARNING} $1${NC}"; }
fi
if ! command -v print_info &> /dev/null; then
    print_info() { echo -e "$1"; }
fi

# Check if package is actually installed (not just known to dpkg)
is_package_installed() {
   dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"
}

# Clean up old NPU packages and conflicting packages
cleanup_old_packages() {
   print_info "Removing old NPU packages and conflicting packages..."
   
   # Remove NPU packages with force to handle conflicts
   dpkg --purge --force-remove-reinstreq intel-driver-compiler-npu intel-fw-npu intel-level-zero-npu 2>/dev/null || true
   
   print_success "Old packages and conflicts cleaned up"
   return 0
}

# Install NPU dependencies
install_dependencies() {
   print_info "Installing NPU dependencies..."
   if ! apt update; then
      print_warning "apt update failed, continuing anyway..."
   fi
   
   if apt install -y libtbb12 wget curl; then
      print_success "Dependencies installed"
      return 0
   else
      print_error "Failed to install dependencies"
      return 1
   fi
}

# Download NPU driver packages
download_npu_packages() {
   print_info "Resolving NPU driver package URL..."
   if [ -z "${NPU_ASSET_URL:-}" ]; then
      resolve_versions || return 1
   fi
   local archive_name
   archive_name=$(basename "$NPU_ASSET_URL")
   print_info "  Downloading ${archive_name}..."
   if wget -q --timeout=30 "${NPU_ASSET_URL}"; then
      print_success "  Downloaded ${archive_name}"
      
      # Extract the archive
      print_info "  Extracting ${archive_name}..."
      if tar -xzf "${archive_name}"; then
         print_success "  Extracted NPU packages from archive"
         rm -f "${archive_name}"  # Clean up archive after extraction
      else
         print_error "  Failed to extract ${archive_name}"
         return 1
      fi
   else
      print_error "  Failed to download asset from ${NPU_ASSET_URL}"
      return 1
   fi
   
   print_success "All NPU packages downloaded successfully"
   return 0
}

# Install NPU packages
install_npu_packages() {
   print_info "Installing NPU driver packages..."
   if dpkg -i ./*.deb; then
      print_success "NPU packages installed successfully"
      return 0
   else
      print_warning "NPU package installation failed, attempting to fix dependencies..."
      if apt install --fix-broken -y && dpkg -i ./*.deb; then
         print_success "NPU packages installed after dependency fix"
         return 0
      else
         print_error "Failed to install NPU packages even after dependency fix"
         return 1
      fi
   fi
}

# Setup device permissions
setup_device_permissions() {
   print_info "Configuring NPU device permissions..."
   
   # Create udev rules
   if echo 'SUBSYSTEM=="accel", KERNEL=="accel*", GROUP="render", MODE="0660"' > /etc/udev/rules.d/10-intel-vpu.rules; then
      print_success "udev rules created"
   else
      print_error "Failed to create udev rules"
      return 1
   fi
   
   # Reload udev rules
   udevadm control --reload-rules
   udevadm trigger --subsystem-match=accel

   print_success "Device permissions configured"
   return 0
}

# User configuration
configure_user_groups() {
   echo -e "\n# Configuring user groups"
   
   local groups=("video" "render")
   local users=("$USER")
   
   # Add native user if running via sudo
   if [ -n "${SUDO_USER:-}" ]; then
      users+=("$SUDO_USER")
   fi
   
   for user in "${users[@]}"; do
      for group in "${groups[@]}"; do
         if ! id -nG "$user" | grep -q -w "$group"; then
            log_info "Adding user $user to group $group"
            usermod -aG "$group" "$user"
         else
            log_success "User $user already in group $group"
         fi
      done
   done
}

# Check NPU device and dmesg
check_npu_device() {
   print_info "Checking NPU device availability..."
   
   if ls /dev/accel/accel0 1>/dev/null 2>&1; then
      print_success "NPU device found: /dev/accel/accel0"
      
      # Show device permissions
      print_info "Device permissions:"
      ls -lah /dev/accel/accel0 2>/dev/null || true
      
      # Check dmesg for intel_vpu state
      print_info "Checking dmesg for intel_vpu messages..."
      dmesg | grep -i "intel_vpu\|npu" | tail -5 || print_info "No recent intel_vpu messages found"
      
      return 0
   else
      print_warning "NPU device not found - reboot may be required"
      return 1
   fi
}

# Verify NPU installation
verify_installation() {
   print_info "Verifying NPU installation..."
   
   # Check NPU packages
   local npu_packages=("intel-driver-compiler-npu" "intel-fw-npu" "intel-level-zero-npu")
   local all_npu_installed=true
   
   for pkg in "${npu_packages[@]}"; do
      if is_package_installed "$pkg"; then
         print_success "Package $pkg installed"
      else
         print_error "Package $pkg not installed"
         all_npu_installed=false
      fi
   done
   
   # Check Level Zero packages (either generic or NPU-specific)
   if is_package_installed "level-zero"; then
      print_success "oneAPI Level Zero installed"
   elif is_package_installed "intel-level-zero-npu"; then
      print_success "NPU Level Zero installed"
   else
      print_error "No Level Zero package found"
   fi
   
   # Check NPU device and dmesg
   check_npu_device
   
   # Check udev rules
   if [ -f "/etc/udev/rules.d/10-intel-vpu.rules" ]; then
      print_success "NPU udev rules configured"
   else
      print_error "NPU udev rules not found"
   fi
   
   print_info ""
   print_info "Installation verification completed"
   if [ "$all_npu_installed" = true ]; then
      print_success "All NPU components installed successfully"
   else
      print_warning "Some NPU components may not be installed correctly"
   fi
}

# Main installation function
install_npu() {
   print_info "Starting NPU installation for Core Ultra platform..."
   
   # Detect Ubuntu version
   detect_ubuntu_version
   
   # Resolve versions and asset URL (auto or overridden)
   resolve_versions || { print_error "Failed to resolve NPU versions"; exit 1; }
   
   # Display version information
   display_version_info
   
   # Check if running as root
   if [ "$EUID" -ne 0 ]; then
      print_error "This script must be run as root (use sudo)"
      exit 1
   fi
   
   # Create temporary directory
   local temp_dir="/tmp/npu_installer_$$"
   mkdir -p "$temp_dir"
   cd "$temp_dir" || { print_error "Failed to create/enter temp directory"; exit 1; }
   
   # Installation steps
   print_info "Step 1: Cleaning up old packages and conflicts..."
   cleanup_old_packages || { print_error "Failed to cleanup old packages"; exit 1; }
   
   print_info "Step 2: Installing dependencies..."
   install_dependencies || { print_error "Failed to install dependencies"; exit 1; }
   
   print_info "Step 3: Downloading NPU packages..."
   download_npu_packages || { print_error "Failed to download NPU packages"; exit 1; }
   
   print_info "Step 4: Installing NPU packages..."
   install_npu_packages || { print_error "Failed to install NPU packages"; exit 1; }

   print_info "Step 5: Setting up device permissions..."
   setup_device_permissions || { print_error "Failed to setup device permissions"; exit 1; }
   configure_user_groups
   
   # Cleanup
   print_info "Step 6: Cleaning up temporary files..."
   cd / || exit 1
   rm -rf "$temp_dir"
   print_success "Cleanup completed"

   # Verify installation
   print_info "Step 7: Verifying installation..."
   verify_installation
   
   print_info ""
   print_success "NPU installation completed"
   print_info ""
   # Record the reason instead of a vague "recommended". main_installer.sh
   # shows one banner at the end. See issue #987.
   if [ "${DEVKIT_POST_REBOOT_PASS:-0}" != "1" ] && [ -w /run ] 2>/dev/null; then
      echo "*** System restart required ***" > "${REBOOT_REQUIRED_FILE:-/run/reboot-required}" 2>/dev/null || true
      grep -qxF "Intel NPU driver installed (/dev/accel appears after restart)" \
         "${REBOOT_REQUIRED_REASONS:-/run/reboot-required.pkgs}" 2>/dev/null || \
         echo "Intel NPU driver installed (/dev/accel appears after restart)" \
            >> "${REBOOT_REQUIRED_REASONS:-/run/reboot-required.pkgs}" 2>/dev/null || true
   fi
   print_info "After restarting, verify with: ls /dev/accel/accel0"
   print_info "Expected output: crw-rw---- 1 root render 261, 0 <date> /dev/accel/accel0"
   print_info "Also check dmesg for intel_vpu messages: dmesg | grep intel_vpu"
   print_info ""
}



# Run installation if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
   install_npu
fi
