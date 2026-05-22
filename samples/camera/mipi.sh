#!/bin/bash

# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to prompt user for yes/no input
prompt_yes_no() {
    local prompt="$1"
    local response
    while true; do
        read -r -p "$prompt (y/n): " response
        case "$response" in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo "Please answer yes (y) or no (n).";;
        esac
    done
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to unzip a file into a specified directory
unzip_to_directory() {
    local zip_file=$1
    local target_dir=$2

    # Check if the zip file exists
    if [[ ! -f "$zip_file" ]]; then
        print_error "Zip file '$zip_file' does not exist."
        return 1
    fi

    # Check if the target directory exists, if not create it
    if [[ ! -d "$target_dir" ]]; then
        print_info "Target directory '$target_dir' does not exist. Creating it..."
        if ! mkdir -p "$target_dir"; then
            print_error "Failed to create directory '$target_dir'."
            return 1
        fi
    fi

    # Unzip the file into the target directory
    print_info "Unzipping '$zip_file' into '$target_dir'..."
    sudo unzip -o "$zip_file" -d "$target_dir"
    if ! sudo unzip -o "$zip_file" -d "$target_dir"; then
        print_error "Failed to unzip '$zip_file' into '$target_dir'."
        return 1
    fi

    print_success "Successfully unzipped '$zip_file' into '$target_dir'."
    return 0
}

# Function to search for IPU6 zip file
find_ipu6_zip() {
    local search_dir="${1:-$HOME}"
    local zip_files
    
    print_info "Searching for IPU6 zip file in $search_dir..."
    
    # Search for potential IPU6 zip files
    zip_files=$(find "$search_dir" -name "*IPU*.zip" -o -name "*ARL*.zip" -o -name "*ipu6*.zip" 2>/dev/null || true)
    
    if [[ -n "$zip_files" ]]; then
        echo "$zip_files"
        return 0
    else
        return 1
    fi
}

# Function to install IPU6 packages
install_ipu6_packages() {
    local extract_dir="$1"
    
    print_info "Converting RPM packages to DEB format..."
    cd "$extract_dir"
    
        # Convert RPM packages to DEB
    if ls ./*.rpm >/dev/null 2>&1; then
        if ! sudo alien --to-deb --scripts ./*.rpm; then
            print_error "Failed to convert RPM packages to DEB format."
            return 1
        fi
    else
        print_error "No RPM packages found in $extract_dir"
        return 1
    fi
    
    print_info "Installing IPU6 packages..."
    
    # Install DEB packages in correct order
    local packages=(
        "aiqb-ipu6epmtl_1.0.0-*.deb"
        "icamerasrc_1.0.0-*.deb"
        "libcamhal_1.0.0-*.deb"
        "libiaaiq-ipu6epmtl_1.0.0-*.deb"
        "libiacss-ipu6epmtl_1.0.0-*.deb"
        "ipu6epmtlfw_1.0.0-*.deb"
    )
    
    for package in "${packages[@]}"; do
        # Use a subshell to avoid issues with file globbing
        package_file=$(ls "$package" 2>/dev/null)
        if [[ -n "$package_file" ]]; then
            print_info "Installing $package_file..."
            if ! sudo dpkg -i "$package_file"; then
                print_warning "Failed to install $package_file, attempting to fix dependencies..."
                sudo apt install -f -y
                sudo dpkg -i "$package_file"
            fi
        else
            print_warning "Package matching $package not found, skipping..."
        fi
    done
    
    print_success "IPU6 packages installation completed."
}

# Function to fix library symbolic link issue
fix_library_symlink() {
    print_info "Checking for library symbolic link issues..."
    
    if [[ -e "/lib/libgsticamerainterface-1.0.so.1" ]] && [[ ! -L "/lib/libgsticamerainterface-1.0.so.1" ]]; then
        print_warning "Found non-symbolic link library file. Fixing..."
        
        # Step 1: Identify the actual library file
        ls -l /lib/libgsticamerainterface-1.0.so.*
        
        # Step 2: Remove the existing file if it is not a symbolic link
        sudo rm /lib/libgsticamerainterface-1.0.so.1
        
        # Step 3: Create the symbolic link
        if [[ -f "/lib/libgsticamerainterface-1.0.so.1.0.0" ]]; then
            sudo ln -s /lib/libgsticamerainterface-1.0.so.1.0.0 /lib/libgsticamerainterface-1.0.so.1
            print_success "Fixed library symbolic link."
        else
            print_error "Base library file not found."
            return 1
        fi
        
        # Verify the symbolic link
        ls -l /lib/libgsticamerainterface-1.0.so.1
    fi
}

# Function to setup environment variables
setup_environment() {
    print_info "Setting up IPU6 environment variables..."
    
    # Create environment script
    sudo tee /etc/profile.d/ipu6_env.sh > /dev/null << 'EOF'
#!/bin/bash
export DISPLAY=:0
export XDG_RUNTIME_DIR=/tmp
export GST_PLUGIN_PATH=/usr/lib/gstreamer-1.0
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/lib
export LIBVA_DRIVER_NAME=iHD
export GST_GL_PLATFORM=egl
export GST_GL_API=gles2
EOF

    sudo chmod +x /etc/profile.d/ipu6_env.sh
    # Source the file to make variables available in the current shell
    # shellcheck source=/dev/null
    source /etc/profile.d/ipu6_env.sh
    
    print_success "Environment variables configured."
}

# Function to check and fix firmware authentication issues
check_firmware_auth() {
    print_info "Checking for firmware authentication issues..."
    
    # Check dmesg for authentication failures
    if dmesg | grep -q "FW authentication failed"; then
        print_warning "Firmware authentication failed detected. Switching to unsigned firmware..."
        
        # Backup signed firmware
        if [[ -d "/usr/lib/firmware/intel/ipu" ]]; then
            cd /usr/lib/firmware/intel/ipu || exit
            if [[ -f "ipu6epmtl_fw.bin.zst" ]]; then
                sudo mv ipu6epmtl_fw.bin.zst ipu6epmtl_fw.bin.zst.bk
            fi
            if [[ -f "ipu6epmtl_fw.bin" ]]; then
                sudo mv ipu6epmtl_fw.bin ipu6epmtl_fw.bin.bk
            fi
        fi
        
        # Clone and setup unsigned firmware
        cd /tmp || exit
        if [[ -d "ipu6-camera-bins" ]]; then
            sudo rm -rf ipu6-camera-bins
        fi
        
        print_info "Cloning IPU6 camera bins repository..."
        git clone https://github.com/intel/ipu6-camera-bins.git
        cd ipu6-camera-bins || exit
        git pull
        git checkout iotg_ipu6
        
        # Copy unsigned firmware
        sudo cp -r include/* /usr/include/
        sudo cp -r lib/* /usr/lib/
        
        cd /usr/lib/firmware/intel/ipu || exit
        if [[ -f "/tmp/ipu6-camera-bins/ipu6epmtlfw/unsigned/ipu6epmtl_fw.bin" ]]; then
            sudo cp /tmp/ipu6-camera-bins/ipu6epmtlfw/unsigned/ipu6epmtl_fw.bin .
        fi
        if [[ -f "/tmp/ipu6-camera-bins/ipu6epmtlfw/unsigned/ipu6epmtl_fw.bin.zst" ]]; then
            sudo cp /tmp/ipu6-camera-bins/ipu6epmtlfw/unsigned/ipu6epmtl_fw.bin.zst .
        fi
        
        sync
        print_success "Unsigned firmware installed. System reboot required."
        return 2  # Indicates reboot needed
    else
        print_success "No firmware authentication issues detected."
        return 0
    fi
}

# Function to verify kernel version and installation
verify_kernel() {
    print_info "Verifying kernel installation..."
    
    current_kernel=$(uname -r)
    print_info "Current kernel: $current_kernel"
    
    if [[ "$current_kernel" == *"6.11.10"* ]]; then
        print_success "Correct kernel version is running."
        return 0
    else
        print_warning "Expected kernel version 6.11.10 not detected."
        print_info "Checking available kernels..."
        if grep -q "6.11.10" /boot/grub/grub.cfg; then
            print_info "Kernel 6.11.10 is available but not currently running."
            return 1
        else
            print_error "Kernel 6.11.10 not found in GRUB configuration."
            return 2
        fi
    fi
}

# Function to update GRUB configuration
update_grub_config() {
    print_info "Updating GRUB configuration..."
    
    # Check if GRUB file exists
    if [[ ! -f "/etc/default/grub" ]]; then
        print_error "GRUB configuration file not found."
        return 1
    fi
    
    # Backup original GRUB config
    sudo cp /etc/default/grub /etc/default/grub.backup
    
    # Update GRUB_CMDLINE_LINUX_DEFAULT
    if grep -q "GRUB_CMDLINE_LINUX_DEFAULT" /etc/default/grub; then
        sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet splash i915.enable_guc=3 i915.max_vfs=7 i915.force_probe=* udmabuf.list_limit=8192"/' /etc/default/grub
    else
        echo 'GRUB_CMDLINE_LINUX_DEFAULT="quiet splash i915.enable_guc=3 i915.max_vfs=7 i915.force_probe=* udmabuf.list_limit=8192"' | sudo tee -a /etc/default/grub
    fi
    
    # Set default kernel if 6.11.10 is available
    if grep -q "6.11.10" /boot/grub/grub.cfg; then
        if grep -q "GRUB_DEFAULT" /etc/default/grub; then
            sudo sed -i 's/GRUB_DEFAULT=.*/GRUB_DEFAULT="Advanced options for Ubuntu>Ubuntu, with Linux 6.11.10--000"/' /etc/default/grub
        else
            echo 'GRUB_DEFAULT="Advanced options for Ubuntu>Ubuntu, with Linux 6.11.10--000"' | sudo tee -a /etc/default/grub
        fi
        
        if grep -q "GRUB_TIMEOUT" /etc/default/grub; then
            sudo sed -i 's/GRUB_TIMEOUT=.*/GRUB_TIMEOUT=5/' /etc/default/grub
        else
            echo 'GRUB_TIMEOUT=5' | sudo tee -a /etc/default/grub
        fi
    fi
    
    # Update GRUB
    sudo update-grub
    print_success "GRUB configuration updated."
}

# Function to verify IPU6 installation
verify_ipu6_installation() {
    print_info "Verifying IPU6 installation..."
    
    # Check if IPU6 driver is loaded
    if dmesg | grep -q "ipu6"; then
        print_success "IPU6 driver detected in kernel messages."
        dmesg | grep ipu6
        return 0
    else
        print_warning "IPU6 driver not detected in kernel messages."
        return 1
    fi
}

# Main installation function
main() {
    print_info "Starting Intel IPU6 Camera Setup Script"
    print_info "======================================="
    
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
    
    # Update system
    print_info "Updating system packages..."
    sudo apt update && sudo apt upgrade -y
    
    # Setup Intel repository
    print_info "Setting up Intel repository..."
    
    # Create Intel ARL sources list
    sudo tee /etc/apt/sources.list.d/intel-arl.list > /dev/null << 'EOF'
deb https://download.01.org/intel-linux-overlay/ubuntu noble main non-free multimedia kernels
deb-src https://download.01.org/intel-linux-overlay/ubuntu noble main non-free multimedia kernels
EOF
    
    # Add GPG key
    sudo wget https://download.01.org/intel-linux-overlay/ubuntu/E6FA98203588250569758E97D176E3162086EE4C.gpg -O /etc/apt/trusted.gpg.d/arl.gpg
    
    # Create Intel preferences
    sudo tee /etc/apt/preferences.d/intel-arl > /dev/null << 'EOF'
Package: *
Pin: release o=intel-iot-linux-overlay-noble
Pin-Priority: 2000
EOF
    
    sudo apt update
    export DEBIAN_FRONTEND=noninteractive
    
    # Install required packages
    print_info "Installing required packages (this may take a while)..."
    sudo apt install -y --allow-downgrades \
        vim alien v4l-utils ocl-icd-libopencl1 curl openssh-server net-tools \
        gir1.2-gst-plugins-bad-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gstreamer-1.0 \
        gir1.2-gst-rtsp-server-1.0 gstreamer1.0-alsa gstreamer1.0-gl gstreamer1.0-gtk3 \
        gstreamer1.0-opencv gstreamer1.0-plugins-bad gstreamer1.0-plugins-bad-apps \
        gstreamer1.0-plugins-base gstreamer1.0-plugins-base-apps gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-ugly gstreamer1.0-pulseaudio gstreamer1.0-qt5 gstreamer1.0-rtsp \
        gstreamer1.0-tools gstreamer1.0-x intel-media-va-driver-non-free itt-dev itt-staticdev \
        libdrm-amdgpu1 libdrm-common libdrm-dev libdrm-intel1 libdrm-nouveau2 libdrm-radeon1 \
        libdrm-tests libdrm2 libgstrtspserver-1.0-dev libgstrtspserver-1.0-0 libgstreamer-gl1.0-0 \
        libgstreamer-opencv1.0-0 libgstreamer-plugins-bad1.0-0 libgstreamer-plugins-bad1.0-dev \
        libgstreamer-plugins-base1.0-0 libgstreamer-plugins-base1.0-dev libgstreamer-plugins-good1.0-0 \
        libgstreamer-plugins-good1.0-dev libgstreamer1.0-0 libgstreamer1.0-dev libigdgmm-dev \
        libigdgmm12 libtpms-dev libtpms0 libva-dev libva-drm2 libva-glx2 libva-wayland2 \
        libva-x11-2 libva2 libwayland-bin libwayland-client0 libwayland-cursor0 libwayland-dev \
        libwayland-doc libwayland-egl-backend-dev libwayland-egl1 libwayland-server0 libxatracker2 \
        linux-firmware mesa-utils mesa-va-drivers mesa-vdpau-drivers mesa-vulkan-drivers \
        libvpl-dev libmfx-gen-dev onevpl-tools libvpl-tools build-essential cmake git
    
    # Build kernel if needed
    if ! verify_kernel; then
        print_info "Building and installing custom kernel..."
        
        # Install kernel build dependencies
        sudo apt install -y quilt libssl-dev kernel-wedge liblz4-tool libelf-dev flex bison git
        
        # Clone kernel overlay
        cd /tmp || exit
        if [[ -d "linux-kernel-overlay" ]]; then
            sudo rm -rf linux-kernel-overlay
        fi
        git clone https://github.com/intel/linux-kernel-overlay.git
        cd linux-kernel-overlay || exit
        git checkout mainline-tracking-overlay-v6.11.10-ubuntu-241202T040109Z
        
        # Build kernel
        print_info "Building kernel (this will take a long time)..."
        ./build.sh
        
        # Install kernel packages
        if ls linux-image-*_amd64.deb >/dev/null 2>&1 && ls linux-headers-*_amd64.deb >/dev/null 2>&1; then
            sudo dpkg -i linux-image-*_amd64.deb
            sudo dpkg -i linux-headers-*_amd64.deb
            
            # Update GRUB configuration
            update_grub_config
            
            print_success "Kernel installed successfully. System reboot required."
            
            if prompt_yes_no "Reboot now to use the new kernel?"; then
                sudo reboot
            else
                print_warning "Please reboot manually to use the new kernel before continuing."
                exit 0
            fi
        else
            print_error "Kernel build failed or packages not found."
            exit 1
        fi
    else
        # Still update GRUB config even if kernel is correct
        update_grub_config
    fi
    
    # Handle IPU6 userspace packages
    print_info "Checking for IPU6 userspace packages..."
    
    if prompt_yes_no "Have you downloaded the IPU6 userspace package (ARL-UH_IPU_FW_HDMI-in.zip)?"; then
        # Search for the zip file
        zip_file=""
        if ! zip_files=$(find_ipu6_zip "$HOME"); then
            read -r -p "Please enter the full path to the IPU6 zip file: " zip_file
            if [[ ! -f "$zip_file" ]]; then
                print_error "File not found: $zip_file"
                exit 1
            fi
        else
            # If multiple files found, let user choose
            if [[ $(echo "$zip_files" | wc -l) -gt 1 ]]; then
                print_info "Multiple potential IPU6 zip files found:"
                echo "$zip_files" | nl
                read -r -p "Please enter the number of the correct file: " choice
                zip_file=$(echo "$zip_files" | sed -n "${choice}p")
            else
                zip_file="$zip_files"
            fi
        fi
            
        print_info "Using zip file: $zip_file"
        
        # Extract and install
        extract_dir="/tmp/ipu6_extract"
        if unzip_to_directory "$zip_file" "$extract_dir"; then
            # Find the actual directory with RPM files
            rpm_dir=$(find "$extract_dir" -name "*.rpm" -exec dirname {} \; | head -1)
            if [[ -n "$rpm_dir" ]]; then
                install_ipu6_packages "$rpm_dir"
                fix_library_symlink
            else
                print_error "No RPM files found in extracted package."
                exit 1
            fi
        else
            print_error "Failed to extract IPU6 package."
            exit 1
        fi
    else
        print_warning "Please download the IPU6 userspace package from:"
        print_warning "https://www.intel.com/content/www/us/en/secure/design/confidential/software-kits/kit-details.html?kitId=831484"
        print_warning "Re-run this script after downloading the package."
        exit 1
    fi
    
    # Setup environment
    setup_environment
    
    # Check for firmware authentication issues
    if check_firmware_auth; then
        firmware_result=$?
        if [[ $firmware_result -eq 2 ]]; then
            print_warning "Firmware authentication fix applied. Rebooting..."
            if prompt_yes_no "Reboot now to apply firmware changes?"; then
                sudo reboot
            else
                print_warning "Please reboot manually to apply firmware changes."
            fi
        fi
    fi
    
    # Final verification
    print_info "Performing final verification..."
    verify_ipu6_installation
    
    print_success "Intel IPU6 Camera setup completed successfully!"
    print_info "You can now test the camera with GStreamer commands."
    print_info "Example: gst-launch-1.0 icamerasrc ! videoconvert ! autovideosink"
    
    # Display environment info
    print_info "Environment variables set in /etc/profile.d/ipu6_env.sh"
    print_info "To reload environment: source /etc/profile.d/ipu6_env.sh"
}

# Run main function
main "$@"
