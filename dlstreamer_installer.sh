#!/bin/bash

# DL Streamer Installer for Intel platforms
# Installs Intel Deep Learning Streamer from the Intel APT repository
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Follows the official install guide:
#   https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer/get_started/install/install_guide_ubuntu.html
#
# The guide's prerequisite step (DLS_install_prerequisites.sh) installs the
# GPU and NPU drivers. This kit already installs those via gpu_installer.sh
# and npu_installer.sh, so that step is skipped here.
#
# Version Management:
# - Installs the latest intel-dlstreamer by default
# - Override with DLSTREAMER_VERSION, e.g. DLSTREAMER_VERSION=2026.1.0
# - List available versions with: apt show -a intel-dlstreamer
#
# Environment Management:
# - DL Streamer needs a set of GStreamer variables that upstream expects each
#   user to export in every shell, or paste into their own ~/.bashrc.
# - This installer instead writes /etc/profile.d/intel-dlstreamer.sh, which
#   sources the env script shipped by the package. It applies to every user,
#   needs no per-user edits, and stays correct across package upgrades because
#   no paths or versions are duplicated here.
#
# Usage:
#   sudo ./dlstreamer_installer.sh
#   sudo DLSTREAMER_VERSION=2026.1.0 ./dlstreamer_installer.sh

DLSTREAMER_VERSION="${DLSTREAMER_VERSION:-}"

DLS_KEYRING="/usr/share/keyrings/dls-archive-keyring.gpg"
INTEL_KEYRING="/usr/share/keyrings/intel-gpg-archive-keyring.gpg"
DLS_KEY_URL="https://apt.repos.intel.com/edgeai/dlstreamer/GPG-PUB-KEY-INTEL-DLS.gpg"
INTEL_KEY_URL="https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB"
PROFILE_SCRIPT="/etc/profile.d/intel-dlstreamer.sh"

# Set by detect_ubuntu_version()
REPO_TAG=""

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

# Auto-detect Ubuntu version
detect_ubuntu_version() {
   local ubuntu_ver
   ubuntu_ver=$(lsb_release -r | awk '{print $2}')

   case "$ubuntu_ver" in
      "24.04")
         REPO_TAG="ubuntu24"
         ;;
      *)
         print_warning "Unsupported Ubuntu version: $ubuntu_ver"
         print_warning "This script only supports Ubuntu 24.04 LTS"
         print_error "Please upgrade to Ubuntu 24.04 LTS for DL Streamer support"
         exit 1
         ;;
   esac

   print_info "Detected Ubuntu version: $ubuntu_ver -> $REPO_TAG"
}

# Install prerequisites needed to add the repositories
install_dependencies() {
   print_info "Installing prerequisites..."

   if ! apt-get update; then
      print_error "Failed to update package lists"
      return 1
   fi

   if ! DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
         wget gpg ca-certificates; then
      print_error "Failed to install prerequisites"
      return 1
   fi

   print_success "Prerequisites installed"
}

# Add the Intel DL Streamer and OpenVINO repositories.
# Both are required: intel-dlstreamer pulls the OpenVINO runtime as a dependency.
add_intel_repositories() {
   print_info "Adding Intel APT repositories..."

   if ! wget -qO- "$INTEL_KEY_URL" | gpg --dearmor --yes -o "$INTEL_KEYRING"; then
      print_error "Failed to fetch the Intel software products signing key"
      return 1
   fi

   if ! wget -qO- "$DLS_KEY_URL" > "$DLS_KEYRING"; then
      print_error "Failed to fetch the DL Streamer signing key"
      return 1
   fi

   chmod a+r "$INTEL_KEYRING" "$DLS_KEYRING"

   echo "deb [signed-by=${DLS_KEYRING}] https://apt.repos.intel.com/edgeai/dlstreamer/${REPO_TAG} ${REPO_TAG} main" \
      > /etc/apt/sources.list.d/intel-dlstreamer.list
   echo "deb [signed-by=${INTEL_KEYRING}] https://apt.repos.intel.com/openvino ${REPO_TAG} main" \
      > /etc/apt/sources.list.d/intel-openvino.list

   if ! apt-get update; then
      print_error "Failed to update package lists after adding the repositories"
      return 1
   fi

   print_success "Intel repositories added"
}

# intel-dlstreamer depends on a specific OpenVINO version. The install guide
# requires removing any other OpenVINO packages first, which matters here
# because openvino_installer.sh may already have installed a different one.
check_openvino_conflict() {
   local required installed
   required=$(apt-cache depends intel-dlstreamer 2>/dev/null \
      | grep -oE 'openvino-[0-9]+\.[0-9]+\.[0-9]+' | head -1)
   installed=$(dpkg-query -W -f='${Package}\n' 'openvino-*' 2>/dev/null \
      | grep -E '^openvino-[0-9]+\.[0-9]+\.[0-9]+$' | head -1)

   if [ -n "$installed" ] && [ -n "$required" ] && [ "$installed" != "$required" ]; then
      print_warning "OpenVINO version conflict detected"
      print_info "  installed: $installed"
      print_info "  required : $required"
      print_info "  intel-dlstreamer requires a matching OpenVINO version."
      print_info "  If the install below fails, remove the current packages first:"
      print_info "    sudo apt remove -y 'openvino*' 'libopenvino-*' 'python3-openvino*'"
      print_info "    sudo apt-get autoremove -y"
   fi
}

# Install the DL Streamer package. Pulls OpenVINO and GStreamer as dependencies.
install_dlstreamer_packages() {
   if is_package_installed "intel-dlstreamer" && [ -z "$DLSTREAMER_VERSION" ]; then
      print_success "intel-dlstreamer already installed"
      return 0
   fi

   local pkg_spec="intel-dlstreamer"
   if [ -n "$DLSTREAMER_VERSION" ]; then
      pkg_spec="intel-dlstreamer=${DLSTREAMER_VERSION}"
      print_info "Installing $pkg_spec (this may take a few minutes)..."
   else
      print_info "Installing intel-dlstreamer (this may take a few minutes)..."
   fi

   if ! DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$pkg_spec"; then
      print_error "Failed to install $pkg_spec"
      if [ -n "$DLSTREAMER_VERSION" ]; then
         print_info "  List available versions with: apt show -a intel-dlstreamer"
      fi
      print_info "  If this is an OpenVINO conflict, remove the existing packages:"
      print_info "    sudo apt remove -y 'openvino*' 'libopenvino-*' 'python3-openvino*'"
      return 1
   fi

   apt-get clean
   print_success "intel-dlstreamer installed"
}

# Optional: the OpenCV pre-process backend used by gvadetect loads OpenCV at
# runtime. Registering its library directory avoids the user having to set
# LD_LIBRARY_PATH. Failure here does not prevent DL Streamer from working.
install_opencv_runtime() {
   print_info "Installing the OpenCV runtime (optional)..."

   if ! DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-pip; then
      print_warning "Could not install python3-pip, skipping the OpenCV runtime"
      return 0
   fi

   if ! pip3 install --break-system-packages --ignore-installed --upgrade --quiet \
         --root-user-action=ignore 'opencv-python-headless>=4.12,<4.13'; then
      print_warning "Could not install opencv-python-headless"
      print_info "  The opencv pre-process backend may be unavailable"
      return 0
   fi

   local opencv_dir
   opencv_dir=$(python3 -c 'import cv2, pathlib
p = pathlib.Path(cv2.__file__).parent
for so in p.glob("*.so*"):
    print(so.parent)
    break' 2>/dev/null | head -1)

   if [ -n "$opencv_dir" ]; then
      echo "$opencv_dir" > /etc/ld.so.conf.d/opencv-python-headless.conf
      ldconfig 2>&1 | grep -v 'is not a symbolic link' || true
      print_success "Registered OpenCV library path: $opencv_dir"
   else
      print_warning "Could not locate the OpenCV libraries"
   fi
}

# Configure the DL Streamer environment system-wide.
#
# The install guide asks each user to paste a block of exports into ~/.bashrc,
# or to source the env script in every terminal. Instead we install one
# profile.d script that sources whatever the package provides, so nothing is
# duplicated and package upgrades are picked up automatically.
configure_environment() {
   print_info "Configuring the DL Streamer environment..."

   cat > "$PROFILE_SCRIPT" <<'PROFILE_EOF'
# Intel DL Streamer environment
# Installed by dlstreamer_installer.sh
#
# Sources the environment script shipped by the intel-dlstreamer package, so
# the GStreamer variables it needs are set for every user without anyone
# editing their own ~/.bashrc. Nothing is hardcoded: if the package moves or
# is upgraded, the variables follow.

# The env script requires bash, and profile.d is read by other shells too
[ -n "${BASH_VERSION:-}" ] || return 0

# Only set up once per shell
[ -n "${INTEL_DLSTREAMER_ENV:-}" ] && return 0

# setup_dls_env.sh is the current location; setupvars.sh is kept as a fallback
# for older packages.
for _dls_env in /opt/intel/dlstreamer/scripts/setup_dls_env.sh \
                /opt/intel/dlstreamer/setupvars.sh; do
    if [ -r "$_dls_env" ]; then
        # shellcheck disable=SC1090
        . "$_dls_env" >/dev/null 2>&1
        export INTEL_DLSTREAMER_ENV=1
        break
    fi
done
unset _dls_env

# The samples and download scripts expect MODELS_PATH. Default it per user
# rather than making everyone set it by hand.
if [ -n "${INTEL_DLSTREAMER_ENV:-}" ]; then
    export MODELS_PATH="${MODELS_PATH:-$HOME/models}"
fi

return 0
PROFILE_EOF

   chmod 0644 "$PROFILE_SCRIPT"
   print_success "Wrote $PROFILE_SCRIPT"
   print_info "  Applies to all users at next login. For the current shell, run:"
   print_info "    source $PROFILE_SCRIPT"
}

# Add the invoking user to the groups needed for GPU and NPU access
configure_user_groups() {
   print_info ""
   print_info "# Configuring user groups"

   local target_user="${SUDO_USER:-}"
   if [ -z "$target_user" ] || [ "$target_user" = "root" ]; then
      return 0
   fi

   local group
   for group in video render; do
      if id -nG "$target_user" 2>/dev/null | grep -qw "$group"; then
         print_success "User $target_user already in group $group"
      elif usermod -aG "$group" "$target_user" 2>/dev/null; then
         print_success "Added $target_user to group $group"
      else
         print_warning "Could not add $target_user to group $group"
      fi
   done
}

# Drop stale GStreamer plugin caches so the new gva* elements are discovered
refresh_gstreamer_registry() {
   print_info "Refreshing the GStreamer plugin registry..."

   rm -f /root/.cache/gstreamer-1.0/registry.*.bin 2>/dev/null || true
   local home
   for home in /home/*; do
      if [ -d "$home/.cache/gstreamer-1.0" ]; then
         rm -f "$home"/.cache/gstreamer-1.0/registry.*.bin 2>/dev/null || true
      fi
   done

   print_success "Plugin registry cleared"
}

# Verify the installation
verify_installation() {
   print_info "Verifying DL Streamer installation..."

   local failed=0

   if is_package_installed "intel-dlstreamer"; then
      local version
      version=$(dpkg-query -W -f='${Version}' intel-dlstreamer 2>/dev/null)
      print_success "Package intel-dlstreamer installed (${version:-unknown})"
   else
      print_error "Package intel-dlstreamer not installed"
      failed=1
   fi

   if [ -r /opt/intel/dlstreamer/scripts/setup_dls_env.sh ] || \
      [ -r /opt/intel/dlstreamer/setupvars.sh ]; then
      print_success "DL Streamer environment script present"
   else
      print_error "DL Streamer environment script missing"
      failed=1
   fi

   if [ -r "$PROFILE_SCRIPT" ]; then
      print_success "Environment configured system-wide"
   else
      print_error "Environment script missing: $PROFILE_SCRIPT"
      failed=1
   fi

   # The documented check: gst-inspect-1.0 gvadetect should show the element
   if bash -c ". $PROFILE_SCRIPT 2>/dev/null; gst-inspect-1.0 gvadetect >/dev/null 2>&1"; then
      print_success "gst-inspect-1.0 reports the gvadetect element"
   else
      print_warning "gvadetect not reported yet"
      print_info "  This usually resolves after logging out and back in"
   fi

   print_info ""
   if [ "$failed" -eq 0 ]; then
      print_success "All DL Streamer components installed successfully"
   else
      print_error "Some DL Streamer components are missing"
   fi

   return "$failed"
}

# Main installation function
install_dlstreamer() {
   print_info "Starting DL Streamer installation..."

   # Check if running as root
   if [ "$EUID" -ne 0 ]; then
      print_error "This script must be run as root (use sudo)"
      exit 1
   fi

   detect_ubuntu_version
   [ -n "$DLSTREAMER_VERSION" ] && print_info "Requested version: $DLSTREAMER_VERSION"

   print_info "Step 1: Installing prerequisites..."
   install_dependencies || { print_error "Failed to install prerequisites"; exit 1; }

   print_info "Step 2: Adding Intel repositories..."
   add_intel_repositories || { print_error "Failed to add Intel repositories"; exit 1; }

   print_info "Step 3: Checking for OpenVINO conflicts..."
   check_openvino_conflict

   print_info "Step 4: Installing DL Streamer packages..."
   install_dlstreamer_packages || { print_error "Failed to install DL Streamer"; exit 1; }

   print_info "Step 5: Installing the OpenCV runtime..."
   install_opencv_runtime

   print_info "Step 6: Configuring the environment..."
   configure_environment || { print_error "Failed to configure the environment"; exit 1; }
   configure_user_groups

   print_info "Step 7: Refreshing the GStreamer registry..."
   refresh_gstreamer_registry

   print_info "Step 8: Verifying installation..."
   verify_installation

   print_info ""
   print_success "DL Streamer installation completed"
   print_info ""
   print_info "The environment is applied automatically at next login."
   print_info "To use it in the current shell, run:"
   print_info "  source $PROFILE_SCRIPT"
   print_info ""
   print_info "Verify with:"
   print_info "  gst-inspect-1.0 gvadetect"
   print_info ""
   print_info "To run a sample pipeline:"
   print_info "  /opt/intel/dlstreamer/samples/download_public_models.sh yolo11s"
   print_info "  gst-launch-1.0 videotestsrc num-buffers=100 ! video/x-raw,width=640,height=640 ! \\"
   print_info "    videoconvert ! gvadetect model=\$MODELS_PATH/public/yolo11s/FP16/yolo11s.xml \\"
   print_info "    device=CPU ! gvafpscounter ! fakesink"
   print_info ""
}

# Run installation if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
   install_dlstreamer
fi
