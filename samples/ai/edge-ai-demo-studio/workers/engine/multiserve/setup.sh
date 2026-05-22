#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

# --- Global Variables ---
UV_INSTALL_SCRIPT="https://astral.sh/uv/install.sh"
if [ -n "$UV_PATH" ]; then
    UV_EXE="$UV_PATH"
elif command -v uv >/dev/null 2>&1; then
    UV_EXE=$(command -v uv)
else
    UV_EXE="$HOME/.local/bin/uv"
fi
VENV_ACTIVATE_SCRIPT=".venv/bin/activate"

LLAMA_VERSION=b7992
# LLAMA_RELEASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-b7180-bin-ubuntu-x64.zip"
LLAMA_RELEASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-ubuntu-vulkan-x64.tar.gz"
LLAMA_DOWNLOAD_FILE="llama-ubuntu.tar.gz"
LLAMA_EXTRACT_DIR="engine/llama.cpp-vulkan"

XPU_SMI_RELEASE_URL="https://github.com/intel/xpumanager/releases/download/v1.3.6/xpu-smi_1.3.6_20260206.143628.1004f6cb.u24.04_amd64.deb"
XPU_SMI_DOWNLOAD_FILE="xpu-smi.deb"
XPU_SMI_INSTALL_DIR="engine/xpu-smi"

GGUF_PARSER_RELEASE_URL="https://github.com/gpustack/gguf-parser-go/releases/download/v0.22.1/gguf-parser-linux-amd64"
GGUF_PARSER_BINARY_NAME="gguf-parser"
GGUF_PARSER_INSTALL_DIR="engine"

OVMS_VERSION="v2026.0"
OVMS_RELEASE_URL="https://github.com/openvinotoolkit/model_server/releases/download/${OVMS_VERSION}/ovms_ubuntu24_python_on.tar.gz"
OVMS_DOWNLOAD_FILE="ovms.tar.gz"
OVMS_EXTRACT_DIR="engine"

OPTIMUM_EXPORT_MODEL_URL="https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/${OVMS_VERSION}/demos/common/export_models"
OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL="requirements.txt"

# --- Utility Functions ---
print_step() {
    echo ""
    echo "## $1"
}

print_success() {
    echo "**SUCCESS:** $1"
}

print_error() {
    echo "**ERROR:** $1"
}

print_warning() {
    echo "**WARNING:** $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if file exists and is executable
is_executable() {
    [[ -f "$1" && -x "$1" ]]
}

# Download file with progress
download_file() {
    local url="$1"
    local output="$2"
    local description="${3:-file}"
    
    echo "Downloading $description..."
    if ! curl -L --progress-bar "$url" -o "$output"; then
        print_error "Failed to download $description from $url"
        return 1
    fi
    print_success "Downloaded $description"
    return 0
}

# --- Installation Functions ---

# Check and setup Mesa drivers (kisak-mesa)
check_mesa_drivers() {
    print_step "0. Mesa Drivers Check"

    # Only relevant for Debian/Ubuntu (apt)
    if ! command_exists apt-get; then
        print_warning "Not on a Debian/Ubuntu-based system. Skipping Mesa driver check."
        return 0
    fi

    # Check if PPA is already added
    if grep -r "kisak/kisak-mesa" /etc/apt/sources.list /etc/apt/sources.list.d/ >/dev/null 2>&1; then
        print_success "kisak-mesa PPA is already configured."
        return 0
    fi

    echo "kisak-mesa PPA not found."
    
    # Ask user for permission to proceed with sudo
    echo "Attempting to add 'ppa:kisak/kisak-mesa' to your system."
    echo "This operation requires 'sudo' privileges."
    read -p "Do you want to proceed? [y/N] " -n 1 -r
    echo "" # move to a new line
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warning "Skipping automatic setup by user request."
        echo "To install manually, run:"
        echo "    sudo add-apt-repository ppa:kisak/kisak-mesa"
        echo "    sudo apt update"
        return 0
    fi

    # Install software-properties-common if missing (needed for add-apt-repository)
    if ! command_exists add-apt-repository; then
        echo "Installing software-properties-common..."
        if ! sudo apt-get update && sudo apt-get install -y software-properties-common; then
            print_error "Failed to install software-properties-common."
            return 1
        fi
    fi

    # Add PPA and update
    echo "Adding PPA: ppa:kisak/kisak-mesa..."
    if ! sudo add-apt-repository -y ppa:kisak/kisak-mesa; then
        print_error "Failed to add kisak-mesa PPA."
        return 1
    fi

    echo "Updating package lists..."
    if ! sudo apt-get update; then
        print_error "Failed to update package lists."
        return 1
    fi

    print_success "kisak-mesa PPA added and apt updated."
    print_warning "To upgrade to the latest Mesa drivers, please run: sudo apt upgrade"
    return 0
}

# Install uv package manager
install_uv() {
    print_step "1. uv Installation"
    
    if is_executable "$UV_EXE"; then
        print_success "uv is already installed. Skipping installation."
        return 0
    fi
    
    echo "uv is NOT found. Attempting to install uv now..."
    if ! curl -LsSf "$UV_INSTALL_SCRIPT" | sh; then
        print_error "uv installation script failed!"
        return 1
    fi
    
    if ! is_executable "$UV_EXE"; then
        print_error "uv installation failed! File not found at: $UV_EXE"
        return 1
    fi
    
    print_success "uv installed successfully."
    
    # Add uv to PATH for current session if not already there
    export PATH="$HOME/.local/bin:$PATH"
    return 0
}

# Install Llama.cpp binaries
install_llamacpp() {
    print_step "2. Llama.cpp Download and Extraction"
    
    if [[ -d "$LLAMA_EXTRACT_DIR" && "$(find "$LLAMA_EXTRACT_DIR" -name 'llama-*' -type f | wc -l)" -gt 0 ]]; then
        print_success "$LLAMA_EXTRACT_DIR already exists with binaries. Skipping download and extraction."
        return 0
    fi
    
    echo "Creating directory: $LLAMA_EXTRACT_DIR"
    mkdir -p "$LLAMA_EXTRACT_DIR"
    if ! download_file "$LLAMA_RELEASE_URL" "$LLAMA_DOWNLOAD_FILE" "Llama.cpp binaries"; then
        return 1
    fi
    
    echo "Extracting to $LLAMA_EXTRACT_DIR..."
    if ! tar -xzf "$LLAMA_DOWNLOAD_FILE" -C "$LLAMA_EXTRACT_DIR"; then
        print_error "Extraction failed."
        rm -f "$LLAMA_DOWNLOAD_FILE"
        return 1
    fi

    shopt -s dotglob
    local entries=("$LLAMA_EXTRACT_DIR"/*)
    shopt -u dotglob
    if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" ]]; then
        local inner_dir="${entries[0]}"
        echo "Flattening nested directory: $(basename "$inner_dir")"
        if ! mv "$inner_dir"/* "$LLAMA_EXTRACT_DIR"/; then
            print_error "Failed to flatten extracted directory."
            rm -f "$LLAMA_DOWNLOAD_FILE"
            return 1
        fi
        rmdir "$inner_dir" || true
    fi
    
    rm -f "$LLAMA_DOWNLOAD_FILE"
    print_success "Llama.cpp extraction complete."
    return 0
}

# Install XPU-SMI (Intel GPU monitoring tool)
install_xpu_smi() {
    print_step "3. XPU-SMI Installation"

    # Check if we have a global installation
    if command_exists xpu-smi; then
        print_success "XPU-SMI is already installed globally. Skipping installation."
        return 0
    fi
    
    # Check if we have a local installation
    local xpu_smi_bin="$XPU_SMI_INSTALL_DIR/bin/xpu-smi"
    if [[ -d "$XPU_SMI_INSTALL_DIR" && -f "$xpu_smi_bin" ]]; then
        print_success "XPU-SMI is already installed locally at $XPU_SMI_INSTALL_DIR. Skipping installation."
        return 0
    fi
    
    # Download the .deb package
    if ! download_file "$XPU_SMI_RELEASE_URL" "$XPU_SMI_DOWNLOAD_FILE" "XPU-SMI package"; then
        return 1
    fi
    
    # Check if we can install system-wide (requires sudo)
    if command_exists dpkg && [[ $EUID -eq 0 || $(sudo -n true 2>/dev/null; echo $?) -eq 0 ]]; then
        echo "Installing XPU-SMI system-wide..."
        if sudo apt install -y "./$XPU_SMI_DOWNLOAD_FILE"; then
            rm -f "$XPU_SMI_DOWNLOAD_FILE"
            print_success "XPU-SMI installed system-wide."
            return 0
        else
            print_warning "System-wide installation failed, trying local installation..."
        fi
    else
        print_warning "Cannot install system-wide (no sudo access or not on Debian/Ubuntu), trying local installation..."
    fi
    
    # Local installation: extract the .deb package manually
    mkdir -p "$XPU_SMI_INSTALL_DIR"
    
    echo "Extracting XPU-SMI package for local installation..."
    if ! dpkg-deb -x "$XPU_SMI_DOWNLOAD_FILE" "$XPU_SMI_INSTALL_DIR"; then
        print_error "Failed to extract XPU-SMI package."
        rm -f "$XPU_SMI_DOWNLOAD_FILE"
        return 1
    fi
    
    rm -f "$XPU_SMI_DOWNLOAD_FILE"
    
    # Make sure the binary is executable
    if [[ -f "$XPU_SMI_INSTALL_DIR/usr/bin/xpu-smi" ]]; then
        mkdir -p "$XPU_SMI_INSTALL_DIR/bin"
        cp "$XPU_SMI_INSTALL_DIR/usr/bin/xpu-smi" "$XPU_SMI_INSTALL_DIR/bin/"
        chmod +x "$XPU_SMI_INSTALL_DIR/bin/xpu-smi"
        print_success "XPU-SMI installed locally at $XPU_SMI_INSTALL_DIR/bin/xpu-smi"
    else
        print_error "XPU-SMI binary not found after extraction."
        return 1
    fi
    
    return 0
}

# Install GGUF Parser (GGUF file analyzer)
install_gguf_parser() {
    print_step "4. GGUF Parser Installation"
    
    local gguf_parser_path="$GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"
    
    if is_executable "$gguf_parser_path"; then
        print_success "GGUF Parser is already installed at $gguf_parser_path. Skipping installation."
        return 0
    fi
    
    # Create installation directory
    mkdir -p "$GGUF_PARSER_INSTALL_DIR"
    
    # Download the binary
    if ! download_file "$GGUF_PARSER_RELEASE_URL" "$gguf_parser_path" "GGUF Parser binary"; then
        return 1
    fi
    
    # Make it executable
    chmod +x "$gguf_parser_path"
    
    # Verify it works
    if is_executable "$gguf_parser_path"; then
        print_success "GGUF Parser installed successfully at $gguf_parser_path"
    else
        print_error "GGUF Parser installation failed - binary is not executable."
        return 1
    fi
    
    return 0
}

# Install OVMS (OpenVINO Model Server)
install_ovms() {
    print_step "5. OVMS Download and Extraction"
    
    if [[ -d "$OVMS_EXTRACT_DIR/ovms" && -f "$OVMS_EXTRACT_DIR/ovms/bin/ovms" ]]; then
        print_success "$OVMS_EXTRACT_DIR/ovms already exists with binaries. Skipping download and extraction."
    else
        echo "Creating directory: $OVMS_EXTRACT_DIR"
        mkdir -p "$OVMS_EXTRACT_DIR"
        
        if ! download_file "$OVMS_RELEASE_URL" "$OVMS_DOWNLOAD_FILE" "OVMS"; then
            return 1
        fi
        
        echo "Extracting to $OVMS_EXTRACT_DIR..."
        if ! tar -xzf "$OVMS_DOWNLOAD_FILE" -C "$OVMS_EXTRACT_DIR"; then
            print_error "Extraction failed."
            rm -f "$OVMS_DOWNLOAD_FILE"
            return 1
        fi
        
        rm -f "$OVMS_DOWNLOAD_FILE"

        print_success "OVMS extraction complete."
    fi

    # Install Jinja2/MarkupSafe directly into OVMS's own bin directory.
    local OVMS_LIB_PYTHON_DIR="$OVMS_EXTRACT_DIR/ovms/lib/python"
    echo "Installing Jinja2 and MarkupSafe into OVMS lib/python: $OVMS_LIB_PYTHON_DIR"
    if ! "$UV_EXE" pip install --target "$OVMS_LIB_PYTHON_DIR" "Jinja2==3.1.6" "MarkupSafe==3.0.2"; then
        print_error "Failed to install Jinja2/MarkupSafe into OVMS lib/python."
        return 1
    fi

    OPTIMUM_VENV_DIR="$OVMS_EXTRACT_DIR/ovms/lib/optimum_venv"

    if ! mkdir -p "$OPTIMUM_VENV_DIR"; then
        print_error "Failed to create directory for optimum in OVMS lib."
        return 1
    fi

    echo "Creating Optimum virtualenv at $OPTIMUM_VENV_DIR"
    if ! "$UV_EXE" venv "$OPTIMUM_VENV_DIR" --clear; then
        print_error "Failed to create virtualenv for Optimum."
        return 1
    fi

    echo "Installing requirements into Optimum venv"
    if ! "$UV_EXE" pip install --python "$OPTIMUM_VENV_DIR" --prerelease allow --index-strategy unsafe-best-match -r "$OPTIMUM_EXPORT_MODEL_URL/$OPTIMUM_EXPORT_MODEL_REQUIREMENTS_URL"; then
        print_error "Failed to install Optimum requirements into venv at $OPTIMUM_VENV_DIR."
        return 1
    fi

    if ! "$UV_EXE" pip install --python "$OPTIMUM_VENV_DIR" datasets "pyarrow<21.0.0"; then
        print_error "Failed to install into Optimum venv."
        return 1
    fi
    print_success "OVMS setup complete with Optimum export model environment ready at $OVMS_OPTIMUM_LIB/venv"
}

# Sync Python environment with uv
sync_uv_environment() {
    print_step "6. uv Sync"
    
    echo "Running uv sync in the current project folder..."
    if ! "$UV_EXE" sync; then
        print_error "uv sync failed. Check your project configuration."
        return 1
    fi
    
    print_success "uv sync completed successfully!"
    return 0
}

# Verify installations
verify_installations() {
    print_step "7. Verification"
    
    local verification_failed=false
    
    # Check uv
    if is_executable "$UV_EXE"; then
        print_success "uv: OK"
    else
        print_error "uv: FAILED"
        verification_failed=true
    fi
    
    # Check Llama.cpp
    local llama_bin_count
    llama_bin_count=$(find "$LLAMA_EXTRACT_DIR" -name 'llama-*' -type f 2>/dev/null | wc -l)
    if [[ $llama_bin_count -gt 0 ]]; then
        print_success "Llama.cpp: OK ($llama_bin_count binaries found)"
    else
        print_error "Llama.cpp: FAILED (no binaries found)"
        verification_failed=true
    fi
    
    # Check XPU-SMI
    if command_exists xpu-smi || [[ -f "$XPU_SMI_INSTALL_DIR/bin/xpu-smi" ]]; then
        print_success "XPU-SMI: OK"
    else
        print_warning "XPU-SMI: FAILED or not installed"
    fi
    
    # Check GGUF Parser
    if is_executable "$GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"; then
        print_success "GGUF Parser: OK"
    else
        print_error "GGUF Parser: FAILED"
        verification_failed=true
    fi
    
    # Check OVMS
    if [[ -f "$OVMS_EXTRACT_DIR/ovms/bin/ovms" ]]; then
        print_success "OVMS: OK"
    else
        print_error "OVMS: FAILED"
        verification_failed=true
    fi
    
    # Check Python environment
    if [[ -f "$VENV_ACTIVATE_SCRIPT" ]]; then
        print_success "Python Virtual Environment: OK"
    else
        print_error "Python Virtual Environment: FAILED"
        verification_failed=true
    fi
    
    if [[ "$verification_failed" == "true" ]]; then
        print_error "Some components failed verification. Please check the logs above."
        return 1
    else
        print_success "All components verified successfully!"
        return 0
    fi
}

# Print final instructions
print_final_instructions() {
    echo ""
    echo "**All setup tasks completed successfully!**"
    echo ""
    echo "----------------------------------------------------------------------"
    echo "**NEXT STEP:** The development environment is ready."
    echo "To **ACTIVATE** the Python environment in this terminal, run:"
    echo ""
    echo "    source $VENV_ACTIVATE_SCRIPT"
    echo ""
    echo "After activation, you can run: python app.py"
    echo ""
    echo "**Available Tools:**"
    echo "  • Llama.cpp binaries: $LLAMA_EXTRACT_DIR/"
    echo "  • GGUF Parser: $GGUF_PARSER_INSTALL_DIR/$GGUF_PARSER_BINARY_NAME"
    echo "  • OVMS: $OVMS_EXTRACT_DIR/ovms/bin/ovms"
    if command_exists xpu-smi; then
        echo "  • XPU-SMI: $(which xpu-smi) (system-wide)"
    elif [[ -f "$XPU_SMI_INSTALL_DIR/bin/xpu-smi" ]]; then
        echo "  • XPU-SMI: $XPU_SMI_INSTALL_DIR/bin/xpu-smi (local)"
    fi
    echo "----------------------------------------------------------------------"
}

# --- Main Script Execution ---
main() {
    echo ""
    echo "=== Project Setup Script (Enhanced with Functions) ==="
    echo ""
    
    # Install components
    # check_mesa_drivers || exit 1
    install_uv || exit 1
    install_llamacpp || exit 1
    install_xpu_smi || exit 1
    install_gguf_parser || exit 1
    install_ovms || exit 1
    sync_uv_environment || exit 1
    
    # Verify everything worked
    verify_installations || exit 1
    
    # Show final instructions
    print_final_instructions
}

# Run main function
main "$@"
