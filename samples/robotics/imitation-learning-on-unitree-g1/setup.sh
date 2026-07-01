#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Setup script for Imitation Learning on Unitree G1
# Installs all dependencies, SDKs, and Python environments
#
# Prerequisites:
#   - isaacgym extracted to thirdparty/isaacgym
#   - Linux system (Ubuntu 22.04+ recommended)
#   - sudo access for system package installation
#

set -euo pipefail

# ============================================================================
# CONFIGURATION & LOGGING
# ============================================================================

HOME_DIR="$(dirname "$(readlink -f "$0")")"
readonly HOME_DIR
readonly THIRDPARTY_DIR="$HOME_DIR/thirdparty"
readonly TRAINING_WS_DIR="$HOME_DIR/training-ws"
readonly VENV_TWIST2="$HOME_DIR/.twist2-venv"
readonly VENV_GMR="$HOME_DIR/.gmr-venv"
readonly VENV_TELEIMAGER="$HOME_DIR/.teleimager-venv"
readonly VENV_TRAINING="$TRAINING_WS_DIR/.venv"

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

# Logging helper
log_info() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
}

die() {
    log_error "$*"
    exit 1
}

# Cleanup function for graceful exit
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log_error "Setup failed with exit code $exit_code"
    fi
    # Deactivate any active venv
    if [ -n "${VIRTUAL_ENV:-}" ]; then
        deactivate 2>/dev/null || true
    fi
    exit $exit_code
}

trap cleanup EXIT

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

log_info "Performing pre-flight checks..."

mkdir -p "$THIRDPARTY_DIR"

# Check isaacgym
if [ ! -d "$THIRDPARTY_DIR/isaacgym" ]; then
    log_error "isaacgym not found at $THIRDPARTY_DIR/isaacgym"
    echo ""
    echo "Please download and extract isaacgym:"
    echo "  1. Visit: https://developer.nvidia.com/isaac-gym"
    echo "  2. Extract to: $THIRDPARTY_DIR/isaacgym"
    echo "  3. Run this script again"
    exit 1
fi

# Check for required commands
for cmd in git wget python3 uv curl gpg lsb_release; do
    if ! command -v "$cmd" &> /dev/null; then
        log_error "$cmd is not installed"
        exit 1
    fi
done

log_info "All pre-flight checks passed"


# ============================================================================
# SYSTEM DEPENDENCIES
# ============================================================================

log_info "Installing system dependencies..."

if ! command -v redis-server &> /dev/null; then
    log_info "Redis not found. Installing system packages..."
    sudo apt-get update || die "Failed to update package cache"
    sudo apt-get install -y \
        redis-server \
        build-essential \
        cmake \
        python3-dev \
        python3-pip \
        pybind11-dev \
        wget \
        git \
        || die "Failed to install system packages"
    log_info "System packages installed"
else
    log_info "System dependencies already installed"
fi

# ============================================================================
# REALSENSE SDK
# ============================================================================

log_info "Checking RealSense SDK..."
if ! command -v realsense-viewer &> /dev/null; then
    log_info "RealSense SDK not found. Installing..."
    sudo apt-get install -y apt-transport-https || die "Failed to install apt-transport-https"

    sudo mkdir -p /etc/apt/keyrings
    curl -sSf https://librealsense.realsenseai.com/Debian/librealsenseai.asc | \
        gpg --dearmor | sudo tee /etc/apt/keyrings/librealsenseai.gpg > /dev/null

    echo "deb [signed-by=/etc/apt/keyrings/librealsenseai.gpg] https://librealsense.realsenseai.com/Debian/apt-repo $(lsb_release -cs) main" | \
        sudo tee /etc/apt/sources.list.d/librealsense.list

    sudo apt-get update || die "Failed to update package cache after adding RealSense repo"
    sudo apt-get install -y librealsense2 librealsense2-utils \
        || die "Failed to install RealSense SDK"
    log_info "RealSense SDK installed"
else
    log_info "RealSense SDK already installed"
fi

# Start and configure Redis
log_info "Configuring Redis..."
if ! sudo systemctl is-active --quiet redis-server; then
    sudo systemctl start redis-server || die "Failed to start Redis"
    sudo systemctl enable redis-server || die "Failed to enable Redis"
    log_info "Redis started and enabled"
else
    log_info "Redis is already running"
fi

if [[ "${ALLOW_REMOTE_REDIS:-0}" == "1" ]]; then
    log_warn "Configuring Redis to accept remote connections (0.0.0.0)"
    log_warn "This is suitable for development/testing but NOT for production"
    sudo sed -i.bak 's/^bind .*/bind 0.0.0.0/' /etc/redis/redis.conf
    sudo sed -i.bak 's/^protected-mode .*/protected-mode no/' /etc/redis/redis.conf
    sudo systemctl restart redis-server
    log_info "Redis configured for remote connections (backup: /etc/redis/redis.conf.bak)"
else
    log_info "Leaving Redis bound to localhost. Set ALLOW_REMOTE_REDIS=1 to enable remote connections."
fi


# ============================================================================
# PICO SDK INSTALLATION
# ============================================================================

log_info "Installing PICO SDK..."
PICO_DEB="$THIRDPARTY_DIR/pico_sdk.deb"
if [ ! -f "$PICO_DEB" ]; then
    log_info "Downloading PICO SDK (XRoboToolkit)..."
    wget -q --show-progress \
        "https://github.com/XR-Robotics/XRoboToolkit-PC-Service/releases/download/v1.0.0/XRoboToolkit_PC_Service_1.0.0_ubuntu_22.04_amd64.deb" \
        -O "$PICO_DEB" \
        || die "Failed to download PICO SDK"
fi
sudo dpkg -i "$PICO_DEB" || die "Failed to install PICO SDK"
rm -f "$PICO_DEB"
log_info "PICO SDK installed"


# ============================================================================
# HELPER FUNCTIONS FOR VIRTUAL ENVIRONMENTS
# ============================================================================

setup_venv() {
    local venv_path=$1
    local python_version=$2
    
    if [ ! -d "$venv_path" ]; then
        log_info "Creating virtual environment: $venv_path (Python $python_version)"
        uv venv --python "$python_version" "$venv_path" \
            || die "Failed to create venv at $venv_path"
    else
        log_info "Virtual environment already exists: $venv_path"
    fi
}

run_in_venv() {
    local venv_path=$1
    local description=$2
    shift 2
    
    log_info "Running: $description"
    (
        # shellcheck source=/dev/null
        source "$venv_path/bin/activate"
        "$@" || die "Failed in venv: $description"
    )
}

# ============================================================================
# INSTALLATION FUNCTIONS
# ============================================================================

install_twist2() {
    log_info "Setting up TWIST2 environment..."
    setup_venv "$VENV_TWIST2" "3.8"

    # Clone/update TWIST2
    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "TWIST2" ]; then
            log_info "Cloning TWIST2..."
            git clone https://github.com/xiangyang-95/TWIST2.git TWIST2 \
                || die "Failed to clone TWIST2"
        else
            log_info "TWIST2 already cloned"
        fi
        
        (
            cd TWIST2
            log_info "Checking out twist2-inspire branch..."
            git checkout twist2-inspire || die "Failed to checkout branch"
        )
    )

    # Install TWIST2 dependencies in venv
    run_in_venv "$VENV_TWIST2" "Installing isaacgym" \
        uv pip install -e "$THIRDPARTY_DIR/isaacgym/python"

    run_in_venv "$VENV_TWIST2" "Installing TWIST2 submodules" \
        bash -c "
            cd '$THIRDPARTY_DIR/TWIST2'
            cd rsl_rl && uv pip install -e . && cd ..
            cd legged_gym && uv pip install -e . && cd ..
            cd pose && uv pip install -e . && cd ..
        "

    run_in_venv "$VENV_TWIST2" "Installing TWIST2 Python dependencies" \
        uv pip install --requirement "$HOME_DIR/requirements-twist2.txt"
    
    log_info "TWIST2 installation completed"
}

install_unitree_sdk2() {
    log_info "Setting up Unitree SDK2..."

    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "unitree_sdk2" ]; then
            log_info "Cloning Unitree SDK2..."
            git clone https://github.com/xiangyang-95/unitree_sdk2.git unitree_sdk2 \
                || die "Failed to clone Unitree SDK2"
        else
            log_info "Unitree SDK2 already cloned"
        fi
        
        (
            cd unitree_sdk2/python_binding
            UNITREE_SDK2_PATH="$(pwd)/.."
            export UNITREE_SDK2_PATH
            
            run_in_venv "$VENV_TWIST2" "Installing pybind11 for Unitree SDK2 build" \
                uv pip install pybind11 pybind11-stubgen numpy

            log_info "Building Unitree SDK2 Python bindings..."
            run_in_venv "$VENV_TWIST2" "Building Unitree SDK2 Python bindings" \
                bash build.sh --sdk-path "$UNITREE_SDK2_PATH" \
                || die "Failed to build Unitree SDK2"
            
            SITE_PACKAGES=$("$VENV_TWIST2/bin/python" -c "import site; print(site.getsitepackages()[0])")
            log_info "Installing bindings to: $SITE_PACKAGES"
            
            sudo cp build/lib/unitree_interface.cpython-*-linux-gnu.so "$SITE_PACKAGES/unitree_interface.so" \
                || die "Failed to copy Unitree bindings"
            
            # Verify installation
            run_in_venv "$VENV_TWIST2" "Verifying Unitree SDK installation" \
                python -c "import unitree_interface; print('✓ Unitree SDK installed'); print('Available types:', list(unitree_interface.RobotType.__members__.keys()))"
        )
    )
    
    log_info "Unitree SDK2 installation completed"
}

install_gmr() {
    log_info "Setting up GMR environment..."
    setup_venv "$VENV_GMR" "3.10"

    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "GMR" ]; then
            log_info "Cloning GMR..."
            git clone https://github.com/YanjieZe/GMR.git GMR \
                || die "Failed to clone GMR"
        else
            log_info "GMR already cloned"
        fi
        
        (
            cd GMR
            log_info "Installing GMR..."
            run_in_venv "$VENV_GMR" "Installing GMR package" \
                uv pip install -e .
        )
    )
    
    log_info "GMR installation completed"
}

install_xrobotoolkit() {
    log_info "Setting up XRoboToolkit SDK..."

    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "XRoboToolkit-PC-Service-Pybind" ]; then
            log_info "Cloning XRoboToolkit-PC-Service-Pybind..."
            git clone https://github.com/YanjieZe/XRoboToolkit-PC-Service-Pybind.git \
                XRoboToolkit-PC-Service-Pybind \
                || die "Failed to clone XRoboToolkit"
        else
            log_info "XRoboToolkit already cloned"
        fi
        
        (
            cd XRoboToolkit-PC-Service-Pybind
            
            # Create and clean tmp directory
            rm -rf tmp
            mkdir -p tmp
            
            (
                cd tmp
                log_info "Cloning XRoboToolkit-PC-Service..."
                git clone https://github.com/XR-Robotics/XRoboToolkit-PC-Service.git \
                    || die "Failed to clone XRoboToolkit-PC-Service"
                
                (
                    cd XRoboToolkit-PC-Service/RoboticsService/PXREARobotSDK
                    log_info "Building PXREARobotSDK..."
                    bash build.sh || die "Failed to build PXREARobotSDK"
                )
            )
            
            # Copy build artifacts
            log_info "Installing XRoboToolkit headers and libraries..."
            mkdir -p lib include
            cp tmp/XRoboToolkit-PC-Service/RoboticsService/PXREARobotSDK/PXREARobotSDK.h include/ \
                || die "Failed to copy header"
            cp -r tmp/XRoboToolkit-PC-Service/RoboticsService/PXREARobotSDK/nlohmann include/ \
                || die "Failed to copy nlohmann headers"
            cp tmp/XRoboToolkit-PC-Service/RoboticsService/PXREARobotSDK/build/libPXREARobotSDK.so lib/ \
                || die "Failed to copy library"
            
            # Clean up temporary files
            rm -rf tmp
            
            # Install Python package
            run_in_venv "$VENV_GMR" "Installing XRoboToolkit dependencies" \
                bash -c "cd '$THIRDPARTY_DIR/XRoboToolkit-PC-Service-Pybind' && uv pip install pybind11"
            
            run_in_venv "$VENV_GMR" "Installing XRoboToolkit Python package" \
                bash -c "cd '$THIRDPARTY_DIR/XRoboToolkit-PC-Service-Pybind' && uv pip install -e ."
        )
    )
    
    log_info "XRoboToolkit installation completed"
}

install_teleimager() {
    log_info "Setting up Teleimager environment..."
    setup_venv "$VENV_TELEIMAGER" "3.12"

    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "teleimager" ]; then
            log_info "Cloning Teleimager..."
            git clone https://github.com/unitreerobotics/teleimager.git teleimager \
                || die "Failed to clone Teleimager"
        else
            log_info "Teleimager already cloned"
        fi

        (
            cd teleimager
            log_info "Checking out commit bbb57b0..."
            git checkout bbb57b0 || die "Failed to checkout commit bbb57b0"

            log_info "Installing Teleimager..."
            run_in_venv "$VENV_TELEIMAGER" "Installing Teleimager package" \
                bash -c "cd '$THIRDPARTY_DIR/teleimager' && uv pip install -e '.[server]' && uv pip install psutil pyrealsense2"
        )
    )

    log_info "Teleimager installation completed"
}

setup_twist2_ws() {
    log_info "Setting up TWIST2 workspace ..."
    echo ""

    # Install TWIST2
    install_twist2
    echo ""
    
    # Install Unitree SDK2
    install_unitree_sdk2
    echo ""
    
    # Install GMR
    install_gmr
    echo ""
    
    # Install XRoboToolkit
    install_xrobotoolkit
    echo ""

    # Install Teleimager
    install_teleimager
    echo ""
}

install_cyclonedds() {
    log_info "Building CycloneDDS..."
    
    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "cyclonedds" ]; then
            log_info "Cloning CycloneDDS..."
            git clone https://github.com/eclipse-cyclonedds/cyclonedds -b releases/0.10.x cyclonedds \
                || die "Failed to clone CycloneDDS"
        else
            log_info "CycloneDDS already cloned"
        fi
        
        (
            cd cyclonedds
            if [ ! -d "build" ]; then
                mkdir -p build install
            fi
            
            (
                cd build
                log_info "Configuring CycloneDDS..."
                cmake .. -DCMAKE_INSTALL_PREFIX=../install \
                    || die "Failed to configure CycloneDDS"
                
                log_info "Building CycloneDDS..."
                cmake --build . --target install \
                    || die "Failed to build CycloneDDS"
            )
        )
    )
    
    log_info "CycloneDDS installation completed"
}

install_inspire_hand_sdk() {
    log_info "Installing Inspire Hand SDK..."
    
    (
        cd "$THIRDPARTY_DIR"
        if [ ! -d "inspire_hand_ws" ]; then
            log_info "Cloning Inspire Hand SDK..."
            git clone --recurse-submodules https://github.com/NaCl-1374/inspire_hand_ws.git inspire_hand_ws \
                || die "Failed to clone Inspire Hand SDK"
        else
            log_info "Inspire Hand SDK already cloned"
        fi
        
        (
            cd inspire_hand_ws
            
            log_info "Installing unitree_sdk2_python..."
            run_in_venv "$VENV_TRAINING" "Installing unitree_sdk2_python" \
                bash -c "export CYCLONEDDS_HOME='$THIRDPARTY_DIR/cyclonedds/install' && cd '$THIRDPARTY_DIR/inspire_hand_ws/unitree_sdk2_python' && uv pip install -e ."
            
            log_info "Installing inspire_hand_sdk..."
            run_in_venv "$VENV_TRAINING" "Installing inspire_hand_sdk" \
                bash -c "cd '$THIRDPARTY_DIR/inspire_hand_ws/inspire_hand_sdk' && uv pip install -e ."
        )
    )
    
    log_info "Inspire Hand SDK installation completed"
}

setup_training_ws() {
    log_info "Setting up Training Workspace..."
    echo ""
    
    # Check if training-ws directory exists
    if [ ! -d "$TRAINING_WS_DIR" ]; then
        log_warn "Training workspace not found at $TRAINING_WS_DIR"
        log_warn "Skipping training workspace setup (optional)"
        return 0
    fi
    
    # Create training venv
    setup_venv "$VENV_TRAINING" "3.12"
    echo ""
    
    # Install requirements
    (
        cd "$TRAINING_WS_DIR"
        uv sync || die "Failed to install training workspace dependencies"
    )
    echo ""
    
    # Install CycloneDDS
    install_cyclonedds
    echo ""
    
    # Install Inspire Hand SDK
    install_inspire_hand_sdk
    echo ""
    
    log_info "Training workspace setup completed"
}

# ============================================================================
# MAIN INSTALLATION FUNCTION
# ============================================================================

main() {
    log_info "Starting installation..."
    echo ""
    
    # Setup TWIST2 workspace (TWIST2, Unitree SDK2, GMR, XRoboToolkit)
    setup_twist2_ws
    echo ""
    
    # Setup Training workspace
    setup_training_ws
    echo ""
    
    # ========================================================================
    # SETUP COMPLETE
    # ========================================================================
    log_info "Installation completed successfully!"
    echo ""
    echo "Virtual environments created:"
    echo "  • TWIST2 (Python 3.8):    source $VENV_TWIST2/bin/activate"
    echo "  • GMR (Python 3.10):      source $VENV_GMR/bin/activate"
    echo "  • Training (Python 3.12): source $VENV_TRAINING/bin/activate"
    echo ""
    echo "Environment variables for runtime:"
    echo "  export CYCLONEDDS_HOME=$THIRDPARTY_DIR/cyclonedds/install"
    echo ""
    echo "Next steps:"
    echo "  1. For TWIST2 work: source $VENV_TWIST2/bin/activate"
    echo "  2. For training: source $VENV_TRAINING/bin/activate && export CYCLONEDDS_HOME=$THIRDPARTY_DIR/cyclonedds/install"
    echo "  3. See individual README files for usage instructions"
    echo ""
}

# Run main installation
main
