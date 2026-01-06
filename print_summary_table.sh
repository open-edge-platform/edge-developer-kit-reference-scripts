#!/bin/bash

# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 Intel Corporation

# Print a summary table of system installation status

# Note: Removed 'set -eo pipefail' to prevent early exits from failed commands
# Individual functions handle errors gracefully with timeouts and || true

# Status indicators - using ASCII for better compatibility
readonly S_ERROR="[ERROR]"
readonly S_VALID="[✓]"

# Table formatting constants
readonly -a TABLE_HEADER=("------------------------" "----------------------------------------")

# Initialize global variables
declare -A PKG_VERSIONS
declare -a GPU_COMPUTE_PACKAGES
declare -a GPU_MEDIA_PACKAGES  

# Timeout wrapper for potentially blocking commands
timeout_cmd() {
    local timeout_duration=${1:-5}  # Default 5 seconds
    shift
    timeout "$timeout_duration" "$@" 2>/dev/null || true
}
declare -a GPU_DEPENDENCIES
declare -a NPU_PACKAGES
declare -a OPENVINO_PIP_PACKAGES


# Main execution function
main() {
    print_header
    detect_system_info
    detect_hardware
    detect_components
    validate_configuration
    print_footer
}

# Extract installed HWE version and apt status tag (returns two lines: version, tag)
get_installed_hwe_info() {
    local output="$1"
    local installed_line version tag
    installed_line=$(echo "$output" | grep -E "\[installed" | head -n1 || true)
    if [ -n "$installed_line" ]; then
        version=$(echo "$installed_line" | awk '{print $2}' || true)
        tag=$(echo "$installed_line" | grep -o "\[installed[^]]*\]" || true)
    else
        version=$(echo "$output" | grep -E "linux-image-generic-hwe-" | head -n1 | awk '{print $2}' || true)
        tag=""
    fi
    printf "%s\n%s\n" "$version" "$tag"
}

# Print summary header
print_header() {
    printf "\n==================== System Installation Summary ====================\n"
    printf "%-25s | %-40s\n" "Item" "Value"
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
}

# Detect and display system information
detect_system_info() {
    local kernel_version hwe_stack ubuntu_version
    
    kernel_version=$(timeout_cmd 3 uname -r)
    
    # HWE stack detection using apt list with timeout
    local hwe_kernel_output hwe_version hwe_tag
    hwe_kernel_output=$(timeout_cmd 5 apt list -a --installed linux-image-generic-hwe-* 2>/dev/null || true)
    
    if [ -n "$hwe_kernel_output" ]; then
        read -r hwe_version hwe_tag < <(get_installed_hwe_info "$hwe_kernel_output")
        if [ -n "$hwe_version" ]; then
            if [ -n "$hwe_tag" ]; then
                hwe_stack="Installed ($hwe_version) $hwe_tag"
            else
                hwe_stack="Installed ($hwe_version)"
            fi
        else
            hwe_stack="Installed"
        fi
    else
        hwe_stack="Not Installed"
    fi
    
    # Ubuntu version
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        ubuntu_version="$PRETTY_NAME"
    else
        ubuntu_version="Unknown"
    fi
    
    # Display system information
    printf "%-25s | %-40s\n" "Kernel Version" "$kernel_version"
    printf "%-25s | %-40s\n" "HWE Stack" "$hwe_stack"
    printf "%-25s | %-40s\n" "Ubuntu Version" "$ubuntu_version"
}

# Initialize package arrays
initialize_package_arrays() {
    # NPU packages from npu_installer.sh
    NPU_PACKAGES=(
        "intel-driver-compiler-npu"
        "intel-fw-npu" 
        "intel-level-zero-npu"
        "level-zero"
    )
    
    # GPU packages from gpu_installer.sh
    GPU_COMPUTE_PACKAGES=(
        "libze-intel-gpu1"
        "libze1"
        "intel-metrics-discovery"
        "intel-opencl-icd"
        "clinfo"
        "intel-gsc"
    )
    
    GPU_MEDIA_PACKAGES=(
        "intel-media-va-driver-non-free"
        "libmfx-gen1"
        "libvpl2"
        "libvpl-tools"
        "libva-glx2"
        "va-driver-all"
        "vainfo"
        "intel-ocloc"
        "libze-dev"
    )
    
    GPU_DEPENDENCIES=(
        "curl"
        "wget"
        "gpg-agent"
        "software-properties-common"
        "pciutils"
    )
    
    # OpenVINO packages
    OPENVINO_PIP_PACKAGES=(
        "openvino"
        "openvino-dev"
        "openvino-telemetry"
    )
    
    # Development toolchain packages
    TOOLCHAIN_PACKAGES=(
        "gcc"
        "g++"
        "cmake"
        "make"
        "python3"
        "pip3"
        "git"
        "docker"
        "docker-compose"
    )
}

# Detect NPU hardware and packages
detect_npu() {
    local npu_status npu_pkg npu_ver
    
    # Check if main NPU package is installed with timeout
    npu_pkg=$(timeout_cmd 5 dpkg -l 2>/dev/null | grep 'intel-level-zero-npu' | awk '{print $2}' || true)
    npu_ver=$(timeout_cmd 5 dpkg -l 2>/dev/null | grep 'intel-level-zero-npu' | awk '{print $3}' || true)
    
    if [ -n "$npu_pkg" ]; then
        npu_status="Detected"
    else
        npu_status="Not Detected"
    fi
    
    # Track all NPU packages
    for pkg in "${NPU_PACKAGES[@]}"; do
        local vers
        vers=$(timeout 10 dpkg -l 2>/dev/null | awk '$2 ~ /^'"$pkg"'/ {print $3}' | paste -sd "," - || true)
        PKG_VERSIONS[$pkg]=$vers
    done
    
    # Display NPU status
    printf "%-25s | %-40s\n" "NPU Status" "$npu_status"
    
    # Display NPU components if detected
    if [ "$npu_status" = "Detected" ]; then
        printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
        printf "%-25s | %-40s\n" "NPU Components" ""
        printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
        printf "%-25s | %-40s\n" "NPU Package" "${npu_pkg:-"-"}"
        printf "%-25s | %-40s\n" "NPU Version" "${npu_ver:-"-"}"
        
        for pkg in "${NPU_PACKAGES[@]}"; do
            printf "%-25s | %-40s\n" "$pkg" "${PKG_VERSIONS[$pkg]:-"-"}"
        done
    fi
}

# Detect GPU hardware and packages  
detect_gpu() {
    local gpu_type gpu_info gpu_driver gpu_devices
    
    gpu_type="Not Detected"
    gpu_info="-"
    gpu_driver="-"
    gpu_devices=""
    
    if timeout_cmd 3 lspci | grep -i 'vga\|3d\|display' | grep -i intel >/dev/null; then
        gpu_type="Intel"
        local intel_gpu_count
        intel_gpu_count=$(timeout_cmd 3 lspci | grep -i 'vga\|3d\|display' | grep -i -c intel)
        gpu_info="$intel_gpu_count Intel graphics device(s) detected"
        # Determine driver module (xe preferred over i915)
        if timeout_cmd 3 lsmod | grep -q '^xe'; then
            gpu_driver="xe (loaded)"
        elif timeout_cmd 3 lsmod | grep -q i915; then
            gpu_driver="i915 (loaded)"
        else
            gpu_driver="xe/i915 (not loaded)"
        fi
        
        gpu_devices=$(timeout_cmd 3 lspci | grep -i 'vga\|3d\|display' | grep -i intel)
    elif timeout_cmd 3 lspci | grep -i 'vga\|3d\|display' | head -n1 | grep -q .; then
        gpu_type="Other"
        gpu_info=$(timeout_cmd 3 lspci | grep -i 'vga\|3d\|display' | head -n1)
        gpu_devices=$(timeout_cmd 3 lspci | grep -i 'vga\|3d\|display')
    fi
    
    # Display GPU information
    printf "%-25s | %-40s\n" "GPU Type" "$gpu_type"
    printf "%-25s | %-40s\n" "GPU Count" "$gpu_info"
    printf "%-25s | %-40s\n" "GPU Driver" "$gpu_driver"
    
    # Print each GPU device on separate lines
    if [ -n "$gpu_devices" ]; then
        local device_num=1
        while IFS= read -r device; do
            if [ -n "$device" ]; then
                printf "%-25s | %-40s\n" "GPU Device $device_num" "$device"
                ((device_num++))
            fi
        done <<< "$gpu_devices"
    fi
    
    # Display GPU packages if GPU detected
    if [ "$gpu_type" != "Not Detected" ]; then
        display_gpu_packages
    fi
}

# Display GPU packages in organized sections
display_gpu_packages() {
    # GPU Compute Components
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    printf "%-25s | %-40s\n" "GPU Compute Components" ""
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    
    for pkg in "${GPU_COMPUTE_PACKAGES[@]}"; do
        display_package_if_installed "$pkg"
    done
    
    # GPU Media Components
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    printf "%-25s | %-40s\n" "GPU Media Components" ""
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    
    for pkg in "${GPU_MEDIA_PACKAGES[@]}"; do
        display_package_if_installed "$pkg"
    done
    
    # GPU Dependencies
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    printf "%-25s | %-40s\n" "GPU Dependencies" ""
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    
    for pkg in "${GPU_DEPENDENCIES[@]}"; do
        display_package_if_installed "$pkg"
    done
}

# Helper function to display package if installed
display_package_if_installed() {
    local pkg="$1"
    local pkg_info pkg_version
    
    pkg_info=$(timeout 10 dpkg -l "$pkg" 2>/dev/null | grep "^ii" || true)
    if [ -n "$pkg_info" ]; then
        pkg_version=$(echo "$pkg_info" | awk '{print $3}')
        printf "%-25s | %-40s\n" "$pkg" "$pkg_version"
    fi
}

# Detect hardware components
detect_hardware() {
    initialize_package_arrays
    detect_npu
    detect_gpu
}

# Detect software components
detect_components() {
    detect_openvino
    detect_toolchain
}

# Validate platform configuration
validate_configuration() {
    local validation_passed=true
    local missing_items=()
    
    # HARD CHECK 1: Ubuntu 24.04.3 requirement
    local ubuntu_version ubuntu_version_id
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        ubuntu_version="$PRETTY_NAME"
        ubuntu_version_id="$VERSION_ID"
        
        # Check for Ubuntu 24.04.3 specifically
        if [[ ! "$ubuntu_version" =~ Ubuntu\ 24\.04\.3 ]] && [[ "$ubuntu_version_id" != "24.04" ]]; then
            validation_passed=false
            missing_items+=("Ubuntu 24.04.3 Required (Current: $ubuntu_version)")
        fi
    else
        validation_passed=false
        missing_items+=("OS Release Information Missing")
    fi
    
    # HARD CHECK 2: Kernel 6.14 or 6.17 requirement
    local kernel_version kernel_major kernel_minor
    kernel_version=$(uname -r 2>/dev/null)
    if [ -n "$kernel_version" ]; then
        # Extract major.minor version (e.g., "6.14" from "6.14.0-generic")
        kernel_major=$(echo "$kernel_version" | cut -d. -f1)
        kernel_minor=$(echo "$kernel_version" | cut -d. -f2)
        
        if [ "$kernel_major" = "6" ] && { [ "$kernel_minor" = "14" ] || [ "$kernel_minor" = "17" ]; }; then
            : # acceptable
        else
            validation_passed=false
            missing_items+=("Kernel 6.14.x or 6.17.x Required (Current: $kernel_version)")
        fi
    else
        validation_passed=false
        missing_items+=("Kernel Version Detection Failed")
    fi
    
    # HARD CHECK 3: HWE kernel requirement with 6.14/6.17 version check
    local hwe_stack hwe_kernel_output hwe_version hwe_kernel_major hwe_kernel_minor hwe_tag
    hwe_kernel_output=$(timeout_cmd 5 apt list -a --installed linux-image-generic-hwe-* 2>/dev/null || true)
    
    if [ -n "$hwe_kernel_output" ]; then
        read -r hwe_version hwe_tag < <(get_installed_hwe_info "$hwe_kernel_output")
        if [ -n "$hwe_version" ]; then
            # Extract major.minor version from HWE kernel (e.g., "6.14" from "6.14.0-33.33~24.04.1")
            hwe_kernel_major=$(echo "$hwe_version" | cut -d. -f1)
            hwe_kernel_minor=$(echo "$hwe_version" | cut -d. -f2)
            
            if [ "$hwe_kernel_major" = "6" ] && { [ "$hwe_kernel_minor" = "14" ] || [ "$hwe_kernel_minor" = "17" ]; }; then
                if [ -n "$hwe_tag" ]; then
                    hwe_stack="Installed (6.$hwe_kernel_minor HWE) $hwe_tag"
                else
                    hwe_stack="Installed (6.$hwe_kernel_minor HWE)"
                fi
                
                # Check if current running kernel matches HWE kernel version (6.14 or 6.17)
                if [[ ! "$kernel_version" =~ ^6\.(14|17) ]]; then
                    validation_passed=false
                    missing_items+=("Reboot Required: HWE 6.14/6.17 kernel installed but not running (Current: $kernel_version)")
                fi
            else
                hwe_stack="Installed (Wrong Version: $hwe_version)"
                validation_passed=false
                missing_items+=("HWE Kernel 6.14 or 6.17 Required (Current HWE: $hwe_version)")
            fi
        else
            hwe_stack="Installed (Version Unknown)"
            validation_passed=false
            missing_items+=("HWE Kernel Version Detection Failed")
        fi
    else
        hwe_stack="Not Installed"
        validation_passed=false
        missing_items+=("HWE Kernel Required")
    fi
    
    # HARD CHECK 4: GPU detection (any GPU/dGPU/iGPU must be found)
    local gpu_detected=false
    if timeout_cmd 3 lspci 2>/dev/null | grep -i 'vga\|3d\|display' >/dev/null; then
        gpu_detected=true
    fi
    
    if [ "$gpu_detected" = false ]; then
        validation_passed=false
        missing_items+=("No GPU/dGPU/iGPU Detected")
    fi
    
    # INFORMATIONAL CHECK: NPU driver (optional - only for Core Ultra platforms)
    # NPU is not a hard requirement since not all Intel systems have NPU devices
    # Only Core Ultra platforms have NPU capability - this is purely informational
    
    # Check basic system commands are available
    local missing_commands=()
    for cmd in "uname" "dpkg" "lspci"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing_commands+=("$cmd")
        fi
    done
    
    if [ ${#missing_commands[@]} -gt 0 ]; then
        validation_passed=false
        missing_items+=("System Commands: $(IFS=', '; echo "${missing_commands[*]}")")
    fi
    
    # Display validation result
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    if [ "$validation_passed" = true ]; then
        printf "%-25s | %-40s\n" "Platform Status" "$S_VALID Platform is configured"
    else
        printf "%-25s | %-40s\n" "Platform Status" "$S_ERROR Incorrect platform configuration"
        if [ ${#missing_items[@]} -gt 0 ]; then
            # Dedupe missing_items to avoid repeated entries
            declare -A _seen
            declare -a _unique
            for _item in "${missing_items[@]}"; do
                if [ -n "$_item" ] && [ -z "${_seen[$_item]}" ]; then
                    _seen[$_item]=1
                    _unique+=("$_item")
                fi
            done
            # Print header once, then each missing item on its own line
            printf "%-25s | %-40s\n" "Missing/Invalid Items" "${_unique[0]}"
            for ((i=1; i<${#_unique[@]}; i++)); do
                printf "%-25s | %-40s\n" "" "${_unique[$i]}"
            done
        fi
    fi
    
    # Return the validation result as exit code
    if [ "$validation_passed" = false ]; then
        return 1
    fi
}

# OpenVINO detection
detect_openvino() {
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    printf "%-25s | %-40s\n" "OpenVINO Components" ""
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    
    # Check for Python OpenVINO package (main installation method)
    if command -v python3 >/dev/null 2>&1; then
        local openvino_version
        openvino_version=$(timeout 3 python3 -c "import openvino; print(openvino.__version__)" 2>/dev/null || echo "Not Installed")
        printf "%-25s | %-40s\n" "OpenVINO Python" "$openvino_version"
    fi
    
    # Check for pip-installed Python packages related to OpenVINO
    if command -v pip3 >/dev/null 2>&1; then
        for pip_pkg in "${OPENVINO_PIP_PACKAGES[@]}"; do
            local pip_version
            pip_version=$(timeout 10 pip3 show "$pip_pkg" 2>/dev/null | grep "Version:" | awk '{print $2}' || true)
            if [ -n "$pip_version" ]; then
                printf "%-25s | %-40s\n" "$pip_pkg (pip)" "$pip_version"
            fi
        done
    fi
    
    # Check for OpenVINO runtime packages (system packages)
    local openvino_packages
    openvino_packages=$(timeout 10 dpkg -l 2>/dev/null | grep -i 'openvino\|intel.*toolkit' || true)
    if [ -n "$openvino_packages" ]; then
        while IFS= read -r package; do
            if [ -n "$package" ]; then
                local pkg_name pkg_version
                pkg_name=$(echo "$package" | awk '{print $2}')
                pkg_version=$(echo "$package" | awk '{print $3}')
                printf "%-25s | %-40s\n" "$pkg_name" "$pkg_version"
            fi
        done <<< "$openvino_packages"
    fi
}

# Toolchain and development tools detection
detect_toolchain() {
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    printf "%-25s | %-40s\n" "Development Toolchain" ""
    printf "%-25s-+-%-40s\n" "${TABLE_HEADER[@]}"
    
    # Core development tools
    for tool in "${TOOLCHAIN_PACKAGES[@]}"; do
        if command -v "$tool" >/dev/null 2>&1; then
            local version
            case "$tool" in
                "gcc"|"g++")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | head -n1 | awk '{print $NF}' || true)
                    ;;
                "cmake")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | head -n1 | awk '{print $3}' || true)
                    ;;
                "make")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | head -n1 | awk '{print $3}' || true)
                    ;;
                "python3")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | awk '{print $2}' || true)
                    ;;
                "pip3")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | awk '{print $2}' || true)
                    ;;
                "git")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | awk '{print $3}' || true)
                    ;;
                "docker")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | awk '{print $3}' | sed 's/,//' || true)
                    ;;
                "docker-compose")
                    version=$(timeout 5 "$tool" --version 2>/dev/null | awk '{print $NF}' | sed 's/,//' || true)
                    ;;
                *)
                    version=$("$tool" --version 2>&1 | head -n1 | awk '{print $NF}')
                    ;;
            esac
            printf "%-25s | %-40s\n" "$tool" "$version"
        else
            printf "%-25s | %-40s\n" "$tool" "Not Installed"
        fi
    done
}

# Print footer function
print_footer() {
    printf "=====================================================================\n"
}

# Execute main function
main