# Intel IPU6 GMSL Camera Setup Script for Ubuntu 24.04

This script provides automated setup for Intel IPU6 DKMS drivers, ECI repositories, and ROS2 Jazzy integration for GMSL camera support on Ubuntu 24.04 systems. Script follows the official Intel ECI documentation procedures for reliable and compliant installation.

**Important Notes:**
- This script modifies system configurations and installs kernel modules
- Always backup your system before running the script
- Ensure you have proper licenses for all software components
- Follow your organization's IT policies for system modifications especially on the system proxies

## Table of Contents

- [System Requirements](#system-requirements)
   - [Operating System](#operating-system)
   - [Hardware Requirements](#hardware-requirements)
   - [Software Dependencies](#software-dependencies)
   - [Supported Hardware IDs](#supported-hardware-ids)
   - [Network Requirements](#network-requirements)
- [Hardware Setup and Connections](#hardware-setup-and-connections)
   - [Connection Steps](#connection-steps)
- [BIOS Configurations](#bios-configurations)
- [Quick Start Guide](#quick-start-guide)
   - [Prerequisites](#prerequisites)
   - [Installation Steps](#installation-steps)
   - [Post-Installation Verification](#post-installation-verification)
- [Usage](#usage)
   - [Script Execution Modes](#script-execution-modes)
- [Support and Documentation](#support-and-documentation)
- [Disclaimer](#disclaimer)

## System Requirements

### Operating System
- **Ubuntu 24.04 (Noble Numbat)** - LTS version only
- **Kernel**: 6.8+ with CONFIG_PM=y enabled (automatically managed by script)
- **Architecture**: x86_64 (AMD64)

### Hardware Requirements
- **CPU**: Intel® Core™ Ultra or 12th/13th/14th Gen Intel® Core™ processors
- **IPU6**: Integrated Image Processing Unit 6th generation
- **Memory**: Minimum 8GB RAM (16GB recommended for multi-camera setups)
- **Storage**: At least 10GB free disk space
- **Network**: Internet connectivity for package downloads

### Software Dependencies
- **ROS Distribution**: ROS2 Jazzy Jalisco
- **Compiler**: GCC with kernel headers
- **Build Tools**: DKMS, pahole
- **Firmware**: linux-firmware package

### Supported Hardware IDs
- **12th/13th/14th Gen**: PCI ID `8086:a75d`
- **Intel® Core™ Ultra**: PCI ID `8086:7d19`

### Network Requirements
- Access to `eci.intel.com` for ECI repository
- Access to `packages.ros.org` for ROS packages
- Access to `raw.githubusercontent.com` for GPG keys

## Hardware Setup and Connections

### Connection Steps

1. **Install Add-in-Card (AIC)**
   - Insert GMSL AIC into available PCIe x4 slot
   - Ensure proper seating and secure with bracket
   - Connect any required auxiliary power

2. **Connect GMSL Cameras**
   - Use high-quality GMSL2 cables (Cat6+ recommended)
   - Connect D457 cameras to FAKRA connectors on AIC
   - Ensure proper cable routing to avoid interference

3. **Camera Configuration Switch**
   - Set D457 cameras to MIPI mode (rear switch)
   - Refer to [Intel RealSense D457 datasheet](https://dev.intelrealsense.com/docs/intel-realsense-d400-series-product-family-datasheet)

## BIOS Configurations

Refer here for [IPU6/GMSL BIOS config](https://eci.intel.com/docs/3.3/development/tutorials/enable-gmsl.html#configure-intel-gmsl-serdes-acpi-devices)

After BIOS configuration, verify IPU6 detection:
```bash
# Check IPU6 hardware detection
lspci -nn | grep -E "8086:a75d|8086:7d19"

# Expected output for Intel Core Ultra:
# 00:05.0 Multimedia controller [0480]: Intel Corporation Device [8086:7d19] (rev 04)

# Expected output for 12th/13th/14th Gen:
# 00:05.0 Multimedia controller [0480]: Intel Corporation Device [8086:a75d]
```

## Quick Start Guide

### Prerequisites
Before running the script, ensure:
- Ubuntu 24.04 (Noble Numbat) is installed
- System has internet connectivity
- User has sudo privileges
- At least 2GB free disk space available

### Installation Steps

1. **Download the Script**
   ```bash
   # Clone or download the script
   wget https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/usecases/camera/gmsl/gmsl.sh | bash
   ```

2. **Monitor Installation**
   ```bash
   # Follow the real-time log
   tail -f /tmp/intel_eci_setup_*.log
   ```

3. **Reboot System**
   ```bash
   sudo reboot
   ```

### Post-Installation Verification

After reboot, verify the installation:

```bash
# Check kernel modules
lsmod | grep intel_ipu6

# Check DKMS status
dkms status | grep ipu6-drivers

# Test camera enumeration
rs-enumerate-devices

# Launch RealSense Viewer
realsense-viewer
```

## Usage

### Script Execution Modes

The script supports multiple execution modes for different scenarios:

#### Standard Installation Mode
```bash
# Normal installation (default)
./gmsl.sh
```

#### Verification Mode (Post-Reboot)
```bash
# Verification mode for post-reboot testing
./gmsl.sh --verify
# OR if post-reboot flag is detected automatically
```

#### Verbose Logging Mode
```bash
# Run with detailed logging output
./gmsl.sh 2>&1 | tee installation.log
```

#### Cleanup and Reset
```bash
# The script includes built-in cleanup functionality
# To remove all installed components, use verification mode:
./gmsl.sh --verify

# For manual cleanup, check the cleanup_modules function in the script
# This will remove DKMS modules, packages, and repositories if needed
```

## Support and Documentation

### Official Documentation
- [Intel ECI GMSL Tutorial](https://eci.intel.com/docs/3.3/development/tutorials/enable-gmsl.html)
- [Intel RealSense Documentation](https://dev.intelrealsense.com/)
- [ROS2 Jazzy Documentation](https://docs.ros.org/en/jazzy/)

## Disclaimer

This script is provided "as-is" without warranty of any kind. Always test in a development environment before production deployment. Intel, RealSense, and other trademarks are property of their respective owners.