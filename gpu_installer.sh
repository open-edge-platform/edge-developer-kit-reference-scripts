#!/bin/bash

# Complete Intel Arc GPU Installation Script (BMG/DG2)
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# This is a complete standalone script for Intel Arc BMG and DG2 GPU setup
# Supports Ubuntu 24.04 only with Intel Kobuk team PPA

set -e

# Status indicators - using ASCII for better compatibility
readonly S_ERROR="[ERROR]"
readonly S_VALID="[✓]"
readonly S_INFO="[INFO]"

# Global variables

# Package arrays - exported for external use
export COMPUTE_PACKAGES=(
   "libze-intel-gpu1"
   "libze1"
   "intel-metrics-discovery"
   "intel-opencl-icd"
   "clinfo"
   "intel-gsc"
)

export MEDIA_PACKAGES=(
   "intel-media-va-driver-non-free"
   "libmfx-gen1"
   "libvpl2"
   "libvpl-tools"
   "libva-glx2"
   "va-driver-all"
   "vainfo"
)

# Dependencies
readonly DEPENDENCIES=(
   "curl"
   "wget"
   "gpg-agent"
   "software-properties-common"
   "pciutils"
)

# Combined GPU packages for cleaner installation
readonly COMMON_GPU_PACKAGES=(
   "${COMPUTE_PACKAGES[@]}"
)

readonly MEDIA_GPU_PACKAGES=(
   "${MEDIA_PACKAGES[@]}"
)

readonly OPTIONAL_GPU_PACKAGES=(
   "intel-ocloc"
   "libze-dev"
)

# GPU detection - simplified approach
# Install drivers for any Intel GPU found via lspci

# Utility functions
error_exit() {
   local message="$1"
   local exit_code="${2:-1}"
   
   echo "$S_ERROR $message" >&2
   echo "" >&2
   sync
   sleep 0.1
   exit "$exit_code"
}

log_info() {
   echo "$S_INFO $1"
}

log_success() {
   echo "$S_VALID $1"
}

# Global status flags
DRIVER_INSTALL_OK=0
DRIVER_VERIFY_OK=0

# System verification functions
check_privileges() {
   if [ "$EUID" -ne 0 ]; then
      error_exit "This script must be run with sudo or as root user"
   fi
}

verify_platform() {
   echo -e "\n# Verifying platform"
   local cpu_model
   cpu_model=$(< /proc/cpuinfo grep -m1 "model name" | cut -d: -f2 | sed 's/^[ \t]*//')
   log_info "CPU model: $cpu_model"
}

verify_os() {
   echo -e "\n# Verifying operating system"
   
   if [ ! -e /etc/os-release ]; then
      error_exit "/etc/os-release file not found"
   fi
   
   local current_os_id current_os_version current_os_codename
   current_os_id=$(grep -E '^ID=' /etc/os-release | cut -d'=' -f2- | tr -d '"')
   current_os_version=$(grep -E '^VERSION_ID=' /etc/os-release | cut -d'=' -f2- | tr -d '"')
   current_os_codename=$(grep -E '^VERSION_CODENAME=' /etc/os-release | cut -d'=' -f2- | tr -d '"')
   
   if [ "$current_os_id" != "ubuntu" ] || [ "$current_os_version" != "24.04" ]; then
      error_exit "Only Ubuntu 24.04 is supported. Current: $current_os_id $current_os_version"
   fi
   
   log_success "OS version: $current_os_id $current_os_version ($current_os_codename)"
}

verify_kernel() {
   echo -e "\n# Verifying kernel version"
   local current_kernel ubuntu_version
   current_kernel=$(uname -r)
   ubuntu_version=$(lsb_release -rs)
   
   log_info "Current running kernel: $current_kernel"
   
   if ! dpkg -l | grep -q "linux-generic-hwe-${ubuntu_version}"; then
      log_info "Installing HWE kernel for Ubuntu $ubuntu_version"
      apt update
      apt install -y "linux-generic-hwe-${ubuntu_version}"
   else
      log_success "HWE kernel is already installed"
   fi
}

# PTL platform detection for Core Ultra 3xx U/P/H SKUs
detect_ptl_platform() {
   local cpu_model
   cpu_model=$(grep -m1 "model name" /proc/cpuinfo | cut -d: -f2 | sed 's/^[ \t]*//' || true)
   local ptl_regex='Intel\(R\) Core\(TM\) Ultra .* 3[0-9]{2}[UPH]'
   if echo "$cpu_model" | grep -Eq "$ptl_regex"; then
      PTL_PLATFORM=true
      log_success "PTL platform detected"
   else
      : "${PTL_PLATFORM:=false}"
   fi
   export PTL_PLATFORM
}

# GPU detection functions
detect_gpu() {
   echo -e "\n# Detecting GPU devices"

   if ! command -v lspci >/dev/null 2>&1; then
      error_exit "lspci command not found. Install pciutils: apt-get install pciutils"
   fi

   local gpu_lines
   gpu_lines=$(lspci -nn | grep -Ei 'VGA|DISPLAY' || true)

   if [ -z "$gpu_lines" ]; then
      error_exit "No GPU (VGA/DISPLAY) devices found. This installer targets Intel GPUs."  
   fi

   log_info "Detected GPU device(s):"
   echo "$gpu_lines"

   # If any Intel vendor (8086) present, proceed; else exit.
   if echo "$gpu_lines" | grep -Fq "[8086:"; then
      log_success "Intel GPU vendor (8086) detected; proceeding with installation"
      return 0
   fi

   error_exit "Non-Intel GPU(s) vendor detected (no PCI vendor 8086 present). Unsupported devices:$(printf "\n%s" "$gpu_lines")"
}

# Repository and package management
configure_kobuk_repository() {
   echo -e "\n# Configuring Intel Kobuk GPU repository"
   
   local repo_file="/etc/apt/sources.list.d/kobuk-team-ubuntu-intel-graphics-noble.sources"
   if [ -e "$repo_file" ] || ls /var/lib/apt/lists/ppa.launchpadcontent.net_kobuk-team_intel-graphics_ubuntu_dists_* >/dev/null 2>&1; then
      log_success "Kobuk repository already configured"
      return 0
   fi
   
   log_info "Adding Intel Kobuk GPU repository"
   
   apt-get update
   apt-get install -y software-properties-common
   
   if add-apt-repository -y ppa:kobuk-team/intel-graphics; then
      log_success "Kobuk repository added successfully"
      apt update
   else
      error_exit "Failed to add Kobuk repository"
   fi
}

install_packages() {
   local packages=("$@")
   local failed=0
   
   log_info "Installing packages: ${packages[*]}"
   
   for package in "${packages[@]}"; do
      [ -z "$package" ] && continue
      
      if dpkg -l "$package" 2>/dev/null | grep -q "^ii"; then
         log_success "Package '$package' already installed"
         continue
      fi
      
      log_info "Installing $package"
      if ! apt-get install -y "$package"; then
         echo "$S_ERROR Failed to install $package"
         failed=1
      else
         log_success "Successfully installed $package"
      fi
   done
   
   return $failed
}

remove_conflicting_packages() {
   echo -e "\n# Removing conflicting GPU packages"
   
   local conflicting_packages=(
      "level-zero"
      "intel-graphics-compiler"
      "intel-compute-runtime"
      "intel-media-driver"
   )
   
   for pkg in "${conflicting_packages[@]}"; do
      if dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
         log_info "Removing conflicting package: $pkg"
         apt-get remove -y "$pkg" || true
      fi
   done
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

# Main installation functions
install_gpu_drivers() {
   echo -e "\n# Installing Intel Arc GPU drivers"
   
   remove_conflicting_packages
   configure_kobuk_repository
   
   # Update package lists
   apt update
   apt dist-upgrade -y
   
   # Install dependencies
   log_info "Installing dependencies"
   install_packages "${DEPENDENCIES[@]}" || error_exit "Failed to install dependencies"
   
   # Install GPU packages
   log_info "Installing GPU driver packages"
   install_packages "${COMMON_GPU_PACKAGES[@]}" || error_exit "Failed to install GPU packages"
   
   # Install media packages
   log_info "Installing media acceleration packages"
   install_packages "${MEDIA_GPU_PACKAGES[@]}" || error_exit "Failed to install media packages"
   
   # Install optional packages (non-critical)
   log_info "Installing optional packages"
   install_packages "${OPTIONAL_GPU_PACKAGES[@]}" || log_info "Some optional packages failed to install (non-critical)"
   
   configure_user_groups
   
   # Post-installation configuration (previously post_installation_fixes)
   echo -e "\n# Post-installation configuration"
   
   # Verify critical packages strictly
   local critical_packages=("intel-opencl-icd" "libze-intel-gpu1")
   local missing_packages=()
   local install_errors=0
   for pkg in "${critical_packages[@]}"; do
      if dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
         log_success "$pkg is installed"
      else
         echo "$S_ERROR $pkg is NOT installed"
         missing_packages+=("$pkg")
      fi
   done
   if [ ${#missing_packages[@]} -gt 0 ]; then
      log_info "Attempting reinstall of missing critical packages: ${missing_packages[*]}"
      if ! install_packages "${missing_packages[@]}"; then
         echo "$S_ERROR Reinstall attempt failed for: ${missing_packages[*]}"
         install_errors=1
      fi
      # Re-check after reinstall
      for pkg in "${missing_packages[@]}"; do
         if ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
            echo "$S_ERROR Critical package still missing: $pkg"
            install_errors=1
         fi
      done
   fi

   # DRI device check (required for runtime)
   if [ -e "/dev/dri" ]; then
      log_info "Checking DRI devices: $(find /dev/dri/ -maxdepth 1 -type f -printf '%f ' 2>/dev/null)"
      if ! ls /dev/dri/render* >/dev/null 2>&1; then
         echo "$S_ERROR No /dev/dri/render* devices found"
         install_errors=1
      else
         chmod 666 /dev/dri/render* || echo "$S_ERROR Failed to adjust permissions on render devices"
         log_success "Render devices present"
      fi
   else
      echo "$S_ERROR /dev/dri directory not found"
      install_errors=1
   fi

   if [ $install_errors -eq 0 ]; then
      log_success "Intel GPU driver installation prerequisites validated"
      DRIVER_INSTALL_OK=1
   else
      echo "$S_ERROR Driver installation encountered errors"
      DRIVER_INSTALL_OK=0
   fi
}

# Verify driver installation
verify_drivers() {
   echo -e "\n# Verifying driver installation"

   # Step 1: clinfo presence
   if ! command -v clinfo >/dev/null 2>&1; then
      echo "$S_ERROR clinfo not found (OpenCL runtime not installed)"
      DRIVER_VERIFY_OK=0
      return 1
   fi

   # Step 2: clinfo -l device enumeration
   local clinfo_list
   if ! clinfo_list=$(clinfo -l 2>/dev/null); then
      echo "$S_ERROR clinfo -l failed to execute"
      DRIVER_VERIFY_OK=0
      return 1
   fi

   # Guard against empty or whitespace-only output
   if [ -z "$(printf "%s" "$clinfo_list" | sed -n '/\S/p')" ]; then
      echo "$S_ERROR clinfo -l returned no device/platform information"
      DRIVER_VERIFY_OK=0
      return 1
   fi

   # Determine device count robustly (avoid duplicate '0 0' from grep fallback)
   local device_count
   device_count=$(printf "%s" "$clinfo_list" | awk '/Device[[:space:]]*#/{c++} END{print c+0}')

   if ! [[ "$device_count" =~ ^[0-9]+$ ]]; then
      echo "$S_ERROR OpenCL device count not an integer: '$device_count'"
      DRIVER_VERIFY_OK=0
      return 1
   fi
   if [ "$device_count" -eq 0 ]; then
      echo "$S_ERROR No OpenCL runtime devices reported (clinfo -l empty)"
      DRIVER_VERIFY_OK=0
      return 1
   fi

   log_success "OpenCL runtime working (devices: $device_count)"

   # Optional: show Intel devices (non-fatal if none)
   local intel_devices
   intel_devices=$(printf "%s" "$clinfo_list" | grep -iE '(^|[[:space:]])Intel(|\(R\))' || true)
   if [ -n "$intel_devices" ]; then
      log_success "Intel OpenCL device entries detected"
      echo "$intel_devices"
   else
      log_info "No explicit Intel entries found in clinfo -l (non-fatal)"
   fi

   DRIVER_VERIFY_OK=1
   return 0
}


# Temporary fix for Intel Core Series 2 + Arc B60
apply_arc_b60_fix() {
   local cpu gpu
   cpu=$(grep -m1 'model name' /proc/cpuinfo | grep -oP 'Intel\(R\) Core\(TM\) [0-9] \K2' || true)
   gpu=$(lspci -nn | grep -i 'VGA' | grep 'e211' || true)

   if [ -n "$cpu" ] && [ -n "$gpu" ]; then
      log_info "Detected Intel Core Series 2 CPU with Arc B60 GPU. Applying kernel command line fix."
      local grub_file="/etc/default/grub"
      local param="xe.force_probe=e211 i915.force_probe=!e211"
      if grep -q "GRUB_CMDLINE_LINUX" "$grub_file"; then
         if ! grep -q "$param" "$grub_file"; then
            sed -i "/^GRUB_CMDLINE_LINUX=/ s/\"$/ $param\"/" "$grub_file"
            log_success "Added '$param' to GRUB_CMDLINE_LINUX. Updating GRUB. Please reboot after installation."
            update-grub
         else
            log_info "Kernel parameters already present in GRUB_CMDLINE_LINUX."
         fi
      else
         log_info "GRUB_CMDLINE_LINUX not found in $grub_file. Skipping fix."
      fi
   fi
}

# Temporary fix for PTL platform (Intel Core Ultra X7 358H + GPU 8086:b08f)
apply_xe_ptl_fix() {
   # Apply fix only when regex-based PTL detection is true and target GPU is present
   local gpu_match
   gpu_match=$(lspci -nn | grep -Ei 'VGA|DISPLAY' | grep '8086:b08f' || true)

   if [ "${PTL_PLATFORM:-false}" = true ] && [ -n "$gpu_match" ]; then
      log_info "Detected PTL platform with GPU 8086:b08f. Applying kernel command line fix for xe/i915 force_probe."
      local grub_file="/etc/default/grub"
      local param="xe.force_probe=b08f i915.force_probe=!b08f"
      if grep -q "GRUB_CMDLINE_LINUX" "$grub_file"; then
         if ! grep -q "xe.force_probe=b08f" "$grub_file"; then
            sed -i "/^GRUB_CMDLINE_LINUX=/ s/\"$/ $param\"/" "$grub_file"
            log_success "Added '$param' to GRUB_CMDLINE_LINUX. Updating GRUB. Please reboot after installation."
            update-grub || log_info "update-grub failed; please run manually."
         else
            log_info "Kernel parameters for PTL platform already present."
         fi
      else
         log_info "GRUB_CMDLINE_LINUX not found in $grub_file. Skipping PTL fix."
      fi
   fi
}

# DRM render node numbers are assigned in driver probe order, not by PCI
# address. When xe probes a discrete GPU before i915 probes the integrated one,
# the dGPU takes renderD128, so OpenVINO and DL Streamer report it as GPU.0 and
# the device order is reversed. Pinning the module load order makes it
# deterministic. See issue #922.
#
# Only applied when the integrated GPU is actually served by i915. On platforms
# where it uses xe (Lunar Lake, Panther Lake) both GPUs share one driver, which
# already probes in PCI order, so there is nothing to pin and loading i915
# would serve no purpose.
#
# Note /dev/dri/by-path/ symlinks are stable regardless; only the renderD*
# numbering that these frameworks enumerate by is affected.
configure_drm_node_order() {
   local conf="/etc/modprobe.d/intel-gpu-order.conf"
   local displays igpu_driver

   displays=$(lspci -nn 2>/dev/null | grep -Ei 'vga|display')

   # Need an integrated GPU and at least one Intel discrete GPU
   echo "$displays" | grep -q '^00:02\.0' || return 0
   echo "$displays" | grep -v '^00:02\.0' | grep -qi '\[8086:' || return 0

   # Only meaningful when the integrated GPU is bound to i915
   if [ -L /sys/bus/pci/devices/0000:00:02.0/driver ]; then
      igpu_driver=$(basename "$(readlink -f /sys/bus/pci/devices/0000:00:02.0/driver)")
   fi
   if [ "${igpu_driver:-}" != "i915" ]; then
      log_info "Integrated GPU is on ${igpu_driver:-no driver}, not i915: DRM node order needs no pinning"
      return 0
   fi

   if grep -qs '^softdep xe pre: i915' "$conf"; then
      log_success "DRM node order already pinned in $conf"
      return 0
   fi

   printf '%s\n' \
      '# Load i915 before xe so the integrated GPU keeps DRM renderD128.' \
      '# Minor numbers follow driver probe order, not PCI address. See issue #922.' \
      'softdep xe pre: i915' > "$conf"

   # The drivers may load from the initramfs, so the config must be in it too
   update-initramfs -u >/dev/null 2>&1 || \
      log_info "Run 'sudo update-initramfs -u' before rebooting"

   log_success "Pinned driver load order in $conf (takes effect after reboot)"

   # Show the current mapping. Iterate the symlinks directly rather than
   # parsing ls output (ShellCheck SC2012).
   local link
   for link in /dev/dri/by-path/*render; do
      [ -L "$link" ] || continue
      printf '     %s -> %s\n' "$link" "$(readlink "$link")"
   done
}

# Main function

main() {
   check_privileges

   echo "Intel GPU Driver Installation Script"
   echo "Supports: Intel Arc discrete GPU and Intel integrated GPU"
   echo "========================================================="

   verify_platform
   detect_gpu
   verify_os
   verify_kernel

   # Detect PTL platform across Core Ultra 3xx U/P/H SKUs
   detect_ptl_platform

   # Apply temporary fixes
   apply_arc_b60_fix
   apply_xe_ptl_fix
   configure_drm_node_order

   install_gpu_drivers || echo "$S_ERROR install_gpu_drivers reported failure"
   if ! verify_drivers; then
      # Avoid literal \n in output; use printf for portability
      printf "\n%s GPU installation verification failed. See errors above.\n" "$S_ERROR"
      exit 1
   fi
   if [ $DRIVER_INSTALL_OK -eq 1 ] && [ $DRIVER_VERIFY_OK -eq 1 ]; then
      echo -e "\n# $S_VALID GPU installation completed successfully. Please reboot your system."
   else
      echo -e "\n# $S_ERROR GPU installation incomplete (install_ok=$DRIVER_INSTALL_OK verify_ok=$DRIVER_VERIFY_OK)."
      exit 1
   fi
}

# Allow sourcing without auto-running main (e.g. from main_installer.sh special flow)
if [[ "${GPU_INSTALLER_NO_MAIN:-0}" != "1" ]]; then
   main "$@"
fi
