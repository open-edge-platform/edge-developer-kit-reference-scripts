#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Intel ECI GMSL IPU6 Setup Script for Ubuntu 24.04 (Noble Numbat)
# Based on: https://eci.intel.com/docs/3.3/development/tutorials/enable-gmsl.html
#
# This script is specifically designed for Ubuntu 24.04 with ROS Jazzy
# It installs Intel ECI repository, IPU6 DKMS drivers, and ROS2 RealSense tools

set -e

# Status indicators - using ASCII for better compatibility
S_ERROR="[ERROR]"
S_VALID="[✓]"
S_WARNING="[!]"

# Global configuration
LOG_FILE="/tmp/intel_eci_setup_$(date +%Y%m%d_%H%M%S).log"
ROS_DISTRO="jazzy"

#==============================================================================
# CORE UTILITIES
#==============================================================================

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling function
error_exit() {
    log "$S_ERROR $1"
    exit 1
}

# Success message helper
log_success() {
    log "$S_VALID $1"
}

# Warning message helper
log_warning() {
    log "$S_WARNING $1"
}

#==============================================================================
# SYSTEM VALIDATION
#==============================================================================

validate_system() {
    log "Validating system requirements..."
    
    validate_os
    validate_privileges
    validate_connectivity
    validate_disk_space
    
    log_success "System validation completed"
}

validate_os() {
    [ -e /etc/os-release ] || error_exit "/etc/os-release file not found"
    
    # Extract OS information
    local os_info
    os_info=$(grep -E '^(ID|VERSION_ID|VERSION_CODENAME)=' /etc/os-release)
    eval "$os_info"
    
    # Get Ubuntu point release version if available
    local ubuntu_version=""
    if grep -q "VERSION=" /etc/os-release; then
        ubuntu_version=$(grep -E '^VERSION=' /etc/os-release | cut -d'=' -f2- | tr -d '"' | grep -o '24\.04\.[0-9]' || echo "")
    fi
    
    log "Detected OS: $ID $VERSION_ID ($VERSION_CODENAME)"
    if [ -n "$ubuntu_version" ]; then
        log "Ubuntu point release: $ubuntu_version"
        export UBUNTU_POINT_RELEASE="$ubuntu_version"
    fi
    
    # Validate Ubuntu 24.04 only
    [ "$ID" = "ubuntu" ] || error_exit "Unsupported OS: $ID. This script only supports Ubuntu 24.04"
    [ "$VERSION_ID" = "24.04" ] || error_exit "Unsupported Ubuntu version: $VERSION_ID. This script only supports Ubuntu 24.04"
    [ "$VERSION_CODENAME" = "noble" ] || error_exit "Unsupported Ubuntu codename: $VERSION_CODENAME. Expected 'noble'"
    
    log_success "Ubuntu 24.04 (Noble Numbat) detected"
    
    # Check if this is 24.04.2+ which should have HWE kernel with 6.11+
    if [ -n "$ubuntu_version" ]; then
        local point_release_num
        point_release_num=$(echo "$ubuntu_version" | cut -d'.' -f3)
        if [ "$point_release_num" -ge 2 ]; then
            log_success "Ubuntu $ubuntu_version detected - should include HWE kernel 6.11+ by default"
            export HAS_HWE_BY_DEFAULT=true
        else
            log_warning "Ubuntu $ubuntu_version detected - may need HWE kernel installation for 6.11+"
            export HAS_HWE_BY_DEFAULT=false
        fi
    else
        log_warning "Ubuntu point release version not detected - assuming original 24.04"
        export HAS_HWE_BY_DEFAULT=false
    fi
    
    # Export for other functions
    export VERSION_CODENAME VERSION_ID ID
}

validate_privileges() {
    [ "$EUID" -ne 0 ] || error_exit "This script should not be run as root. Please run as a regular user with sudo privileges"
    
    if ! sudo -n true 2>/dev/null; then
        sudo true || error_exit "Sudo access required"
    fi
}

validate_connectivity() {
    ping -c 1 eci.intel.com >/dev/null 2>&1 || error_exit "Internet connectivity required. Cannot reach eci.intel.com"
}

validate_disk_space() {
    local available_space
    available_space=$(df / | awk 'NR==2 {print $4}')
    [ "$available_space" -ge 2097152 ] || error_exit "Insufficient disk space. At least 2GB required"
}

#==============================================================================
# KERNEL MANAGEMENT
#==============================================================================

manage_kernel() {
    log "Managing kernel compatibility for IPU6 GMSL..."
    
    local current_kernel
    current_kernel=$(uname -r)
    log "Current kernel: $current_kernel"
    
    if is_kernel_compatible "$current_kernel"; then
        log_success "Kernel $current_kernel is compatible with IPU6 GMSL"
        export REBOOT_REQUIRED=false
        return 0
    fi
    
    log_warning "Kernel upgrade required for IPU6 GMSL compatibility"
    install_compatible_kernel
}

is_kernel_compatible() {
    local kernel="$1"
    local major minor
    major=$(echo "$kernel" | cut -d'.' -f1)
    minor=$(echo "$kernel" | cut -d'.' -f2)
    
    # Check if kernel is 6.11+ and generic variant
    if [ "$major" = "6" ] && [ "$minor" -ge 11 ] && echo "$kernel" | grep -q "generic"; then
        return 0
    elif [ "$major" -gt 6 ]; then
        return 0
    fi
    
    return 1
}

install_compatible_kernel() {
    log "Installing compatible kernel (6.11+)..."
    
    sudo apt update
    
    # Try HWE kernel first
    if sudo apt install -y linux-generic-hwe-24.04; then
        log_success "HWE kernel installed successfully"
        export REBOOT_REQUIRED=true
        return 0
    fi
    
    # Fallback to available 6.11+ kernels
    install_fallback_kernel || {
        log_warning "Automatic kernel installation failed"
        log "Manual options:"
        log "1. sudo apt install linux-generic-hwe-24.04"
        log "2. Upgrade to Ubuntu 24.04.2+"
        return 1
    }
}

install_fallback_kernel() {
    local available_kernels
    available_kernels=$(apt-cache search "^linux-image-6\.(11|1[2-9]|[2-9][0-9]).*-generic$" | awk '{print $1}' | sort -V | tail -1)
    
    if [ -n "$available_kernels" ]; then
        local target_kernel="$available_kernels"
        local target_headers="${target_kernel/image/headers}"
        
        log "Installing $target_kernel..."
        if sudo apt install -y "$target_kernel" "$target_headers"; then
            log_success "Fallback kernel installation successful"
            export REBOOT_REQUIRED=true
            return 0
        fi
    fi
    
    return 1
}

#==============================================================================
# REPOSITORY SETUP
#==============================================================================

setup_repositories() {
    log "Setting up ECI and ROS repositories..."
    
    setup_eci_repository
    setup_ros_repository
    update_package_lists
    
    log_success "Repository setup completed (ROS: $ROS_DISTRO)"
}

setup_eci_repository() {
    log "Configuring Intel ECI repository..."
    
    # Download and install ECI GPG key
    sudo wget -O- https://eci.intel.com/repos/gpg-keys/GPG-PUB-KEY-INTEL-ECI.gpg | \
        sudo tee /usr/share/keyrings/eci-archive-keyring.gpg > /dev/null || \
        error_exit "Failed to download ECI GPG key"
    
    # Setup ECI repository
    echo "deb [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/${VERSION_CODENAME} isar main" | \
        sudo tee /etc/apt/sources.list.d/eci.list
    echo "deb-src [signed-by=/usr/share/keyrings/eci-archive-keyring.gpg] https://eci.intel.com/repos/${VERSION_CODENAME} isar main" | \
        sudo tee -a /etc/apt/sources.list.d/eci.list
    
    # Configure repository priorities
    sudo tee /etc/apt/preferences.d/isar > /dev/null << 'EOF'
Package: *
Pin: origin eci.intel.com
Pin-Priority: 1000

Package: libflann*
Pin: version 1.19.*
Pin-Priority: -1

Package: flann*
Pin: version 1.19.*
Pin-Priority: -1
EOF
}

setup_ros_repository() {
    log "Configuring ROS $ROS_DISTRO repository..."
    
    # Download and install ROS GPG key
    sudo wget -O- https://raw.githubusercontent.com/ros/rosdistro/master/ros.key | \
        sudo tee /usr/share/keyrings/ros-archive-keyring.gpg > /dev/null || \
        error_exit "Failed to download ROS GPG key"
    
    # Setup ROS repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu ${VERSION_CODENAME} main" | \
        sudo tee /etc/apt/sources.list.d/ros2.list
}

update_package_lists() {
    log "Updating package lists..."
    sudo apt update || error_exit "Failed to update package lists"
}

#==============================================================================
# PACKAGE INSTALLATION
#==============================================================================

install_packages() {
    log "Installing required packages..."
    
    install_firmware
    install_ipu6_drivers
    install_ros_packages
    
    log_success "Package installation completed"
}

install_firmware() {
    log "Installing IPU6 firmware..."
    sudo apt install -y linux-firmware || error_exit "Failed to install firmware"
    log_success "Firmware installation completed"
}

install_ipu6_drivers() {
    log "Installing IPU6 DKMS drivers..."
    
    # Install prerequisites
    sudo apt install -y pahole "linux-headers-$(uname -r)"
    
    # Verify package availability
    apt-cache show intel-ipu6-dkms >/dev/null 2>&1 || \
        error_exit "intel-ipu6-dkms package not available. Check ECI repository setup"
    
    # Install DKMS package
    sudo apt install -y intel-ipu6-dkms || error_exit "Failed to install intel-ipu6-dkms"
    
    # Verify DKMS installation
    verify_dkms_installation
    
    # Configure user permissions
    configure_user_permissions
    
    log_success "IPU6 drivers installed successfully"
}

verify_dkms_installation() {
    local max_attempts=3
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local dkms_status
        dkms_status=$(dkms status 2>/dev/null | grep 'ipu6-drivers' || echo '')
        
        if echo "$dkms_status" | grep -q 'installed'; then
            log_success "DKMS driver verification successful"
            return 0
        fi
        
        log_warning "DKMS installation incomplete (attempt $attempt/$max_attempts)"
        force_dkms_install
        
        attempt=$((attempt + 1))
        sleep 2
    done
    
    error_exit "DKMS driver installation failed after multiple attempts"
}

force_dkms_install() {
    local dkms_version
    dkms_version=$(dkms status 2>/dev/null | grep 'ipu6-drivers' | head -1 | cut -d'/' -f2 | cut -d',' -f1 || echo "")
    
    if [ -n "$dkms_version" ]; then
        sudo dkms install --force "ipu6-drivers/$dkms_version" 2>/dev/null || true
    fi
}

configure_user_permissions() {
    log "Configuring user permissions..."
    sudo usermod -a -G video "$USER"
    sudo usermod -a -G render "$USER"
    log_success "User added to video and render groups"
}

install_ros_packages() {
    log "Installing ROS2 $ROS_DISTRO packages..."
    
    local ros_package="ros-jazzy-librealsense2-tools"
    
    if sudo apt install -y "$ros_package"; then
        log_success "$ros_package installed successfully"
    else
        log_warning "Package installation failed, attempting dependency resolution..."
        resolve_ros_dependencies "$ros_package"
        sudo apt install -y "$ros_package" || error_exit "Failed to install $ros_package"
    fi
    
    verify_ros_installation
}

resolve_ros_dependencies() {
    local package="$1"
    local base_package
    # shellcheck disable=SC2001
    base_package=$(echo "$package" | sed 's/-tools$//')
    
    # Try to install base package with specific version
    local version
    version=$(apt-cache madison "$base_package" 2>/dev/null | awk '{print $3}' | sort -V | tail -n 1)
    
    if [ -n "$version" ]; then
        sudo apt install -y "${base_package}=${version}" || true
    fi
}

verify_ros_installation() {
    local udev_rules="/lib/udev/rules.d/99-realsense-d4xx-mipi-dfu.rules"
    if [ -f "$udev_rules" ]; then
        log_success "RealSense udev rules found"
    else
        log_warning "RealSense udev rules not found (may be installed during module loading)"
    fi
}

#==============================================================================
# SYSTEM TESTING & VERIFICATION
#==============================================================================

test_system() {
    log "Testing IPU6 GMSL system functionality..."
    
    if ! is_kernel_compatible "$(uname -r)"; then
        log_warning "Kernel testing skipped - reboot required for compatible kernel"
        return 0
    fi
    
    cleanup_modules
    test_hardware_detection
    test_module_loading
    test_kernel_messages
    
    log_success "System testing completed - IPU6 GMSL ready for use"
}

cleanup_modules() {
    if lsmod | grep -q intel_ipu6; then
        log "Cleaning up existing IPU6 modules..."
        sudo rmmod intel_ipu6_isys intel_ipu6_psys intel_ipu6 2>/dev/null || true
    fi
}

test_hardware_detection() {
    log "Testing IPU6 hardware detection..."
    
    if lspci -nn | grep -q "8086:a75d\|8086:7d19"; then
        log_success "Intel IPU6 hardware detected"
    else
        log_warning "Intel IPU6 hardware not detected. Check BIOS settings"
        return 1
    fi
}

test_module_loading() {
    log "Testing IPU6 module loading..."
    
    sudo dmesg -n 7  # Enable debug messages
    
    if sudo modprobe intel-ipu6-isys; then
        log_success "IPU6 modules loaded successfully"
        sleep 3  # Allow initialization
    else
        log "$S_ERROR Failed to load intel-ipu6-isys module"
        return 1
    fi
    
    if lsmod | grep -q intel_ipu6; then
        log_success "IPU6 modules verified in system"
        lsmod | grep intel_ipu6 | while read -r module; do
            log "  - $module"
        done
    else
        log_warning "IPU6 modules not found in loaded modules"
        return 1
    fi
}

test_kernel_messages() {
    log "Checking kernel messages for IPU6/GMSL activity..."
    
    local messages
    messages=$(sudo dmesg | grep -E "(ipu6|d4xx|max929)" | tail -10)
    
    if [ -n "$messages" ]; then
        log "Recent IPU6/GMSL kernel messages:"
        echo "$messages" | while read -r line; do
            log "  $line"
        done
    fi
    
    # Check for firmware errors
    if sudo dmesg | grep -q "FW authentication failed"; then
        local fw_error
        fw_error=$(sudo dmesg | grep "FW authentication failed" | tail -1)
        log_warning "Firmware authentication issue: $fw_error"
        return 1
    else
        log_success "No firmware authentication errors found"
    fi
}

check_kernel_config() {
    log "Checking kernel configuration..."
    
    local kernel_version config_file
    kernel_version=$(uname -r)
    config_file="/boot/config-$kernel_version"
    
    if [ -f "$config_file" ] && grep -q "CONFIG_PM=y" "$config_file"; then
        log_success "Kernel has CONFIG_PM=y (required for IPU6)"
    else
        log_warning "Could not verify CONFIG_PM setting in kernel"
    fi
}

#==============================================================================
# WORKFLOW MODES
#==============================================================================

is_post_reboot_mode() {
    local current_kernel
    current_kernel=$(uname -r)
    
    # Check if on compatible kernel and packages are installed
    if is_kernel_compatible "$current_kernel" && \
       dpkg -l | grep -q "intel-ipu6-dkms" && \
       dpkg -l | grep -q "ros-jazzy-librealsense2-tools"; then
        return 0
    fi
    
    return 1
}

run_installation_mode() {
    log "=== INSTALLATION MODE ==="
    
    validate_system
    manage_kernel
    setup_repositories
    install_packages
    check_kernel_config
    
    # Test if no reboot required
    if [ "${REBOOT_REQUIRED:-false}" != "true" ]; then
        test_system
    fi
    
    print_summary
}

run_verification_mode() {
    local current_kernel="$1"
    
    log "=== POST-REBOOT VERIFICATION MODE ==="
    log "Compatible kernel detected: $current_kernel"
    
    if test_system; then
        print_success_summary "$current_kernel"
        return 0
    else
        print_failure_summary
        return 1
    fi
}

#==============================================================================
# SUMMARY REPORTS
#==============================================================================

print_summary() {
    log "=== Intel ECI GMSL IPU6 Setup Summary ==="
    log "Log file: $LOG_FILE"
    log ""
    log "Setup completed for Ubuntu 24.04 (Noble Numbat) with ROS $ROS_DISTRO"
    log ""
    log "Installed components:"
    log "- Intel ECI repository and IPU6 DKMS drivers"
    log "- ROS2 $ROS_DISTRO RealSense tools"
    log "- Required firmware packages"
    log ""
    
    if [ "${REBOOT_REQUIRED:-false}" = "true" ]; then
        print_reboot_instructions
    else
        print_usage_instructions
    fi
}

print_success_summary() {
    local kernel="$1"
    
    log ""
    log "========================================="
    log "$S_VALID VERIFICATION SUCCESSFUL"
    log "========================================="
    log "IPU6 GMSL setup is working correctly!"
    log "Current kernel: $kernel"
    log "All modules loaded successfully"
    log "System is ready for GMSL camera use"
    log "========================================="
    
    print_verification_details
}

print_failure_summary() {
    log ""
    log "========================================="
    log "$S_ERROR VERIFICATION FAILED"
    log "========================================="
    log "Issues detected with IPU6 GMSL setup"
    log "Check logs above for specific errors"
    log "========================================="
}

print_reboot_instructions() {
    log "========================================="
    log "REBOOT REQUIRED"
    log "========================================="
    log "A compatible kernel (6.11+) has been installed."
    log ""
    log "Next steps:"
    log "1. Reboot your system"
    log "2. Run this script again for verification"
    log "3. Script will automatically detect post-reboot state"
    log "========================================="
    
    read -p "Reboot now? (y/N): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "Rebooting system..."
        sudo reboot
    fi
}

print_usage_instructions() {
    log "Next steps:"
    log "1. Configure BIOS/UEFI settings for GMSL cameras"
    log "2. Test camera functionality with RealSense tools"
    log ""
    log "For troubleshooting:"
    log "https://eci.intel.com/docs/3.3/development/tutorials/enable-gmsl.html"
}

print_verification_details() {
    log "=== System Status ==="
    log "- Kernel: $(uname -r) $S_VALID"
    log "- IPU6 hardware: $(lspci -nn | grep -q "8086:a75d\|8086:7d19" && echo "Detected $S_VALID" || echo "Not detected $S_WARNING")"
    log "- IPU6 modules: $(lsmod | grep -q intel_ipu6 && echo "Loaded $S_VALID" || echo "Not loaded $S_WARNING")"
    log ""
    log "Testing commands:"
    log "1. Check camera devices: ls /dev/video*"
    log "2. List RealSense devices: ros2 run realsense2_camera realsense2_camera_node --ros-args -p list_devices:=true"
    log "3. Test with V4L2: v4l2-ctl --list-devices"
}

#==============================================================================
# MAIN EXECUTION
#==============================================================================

main() {
    log "Starting Intel ECI GMSL IPU6 Setup Script for Ubuntu 24.04"
    log "Documentation: https://eci.intel.com/docs/3.3/development/tutorials/enable-gmsl.html"
    
    # Check if this is post-reboot verification mode
    if is_post_reboot_mode; then
        run_verification_mode "$(uname -r)"
        return $?
    fi
    
    # Run standard installation workflow
    run_installation_mode
    
    log_success "Setup script completed!"
}

# Execute main function
main "$@"