# Intel Camera Systems Troubleshooting Guide

This comprehensive guide covers troubleshooting for Intel IPU6-based camera systems including GMSL, IPU6, and MIPI direct cameras on Ubuntu 24.04 systems.

## Table of Contents

- [System Requirements Verification](#system-requirements-verification)
- [Hardware Detection Issues](#hardware-detection-issues)
- [GMSL Camera Troubleshooting](#gmsl-camera-troubleshooting)
- [IPU6 Camera Troubleshooting](#ipu6-camera-troubleshooting)
- [MIPI Direct Camera Troubleshooting](#mipi-direct-camera-troubleshooting)
- [Common Driver Issues](#common-driver-issues)
- [Firmware Problems](#firmware-problems)
- [GStreamer and Application Issues](#gstreamer-and-application-issues)
- [Performance and Optimization](#performance-and-optimization)
- [Advanced Debugging](#advanced-debugging)
- [Recovery Procedures](#recovery-procedures)
- [Log Collection for Support](#log-collection-for-support)
- [Quick Reference Commands](#quick-reference-commands)

## System Requirements Verification

### Check Operating System Compatibility
```bash
# Verify Ubuntu version (must be 24.04 Noble)
cat /etc/os-release | grep -E "(VERSION_ID|VERSION_CODENAME)"

# Expected output:
# VERSION_ID="24.04"
# VERSION_CODENAME=noble

# Check kernel version (should be 6.8+ for GMSL, 6.11+ for IPU6)
uname -r

# Check architecture
uname -m  # Should show x86_64
```

### Verify Hardware Compatibility
```bash
# Check for Intel IPU6 hardware
lspci -nn | grep -E "8086:a75d|8086:7d19"

# Expected outputs:
# Intel Core Ultra: 8086:7d19
# 12th/13th/14th Gen: 8086:a75d

# Check for GMSL Add-in-Card (if applicable)
lspci | grep -i multimedia

# Check system memory (minimum 8GB recommended)
free -h

# Check available disk space (minimum 10GB required)
df -h /
```

## Hardware Detection Issues

### IPU6 Not Detected
**Symptoms**: No IPU6 device shown in `lspci` output

**Solutions**:
1. **BIOS Configuration**:
   ```bash
   # Check if IPU6 is enabled in BIOS
   # Navigate to: Advanced > System Agent Configuration > IPU Configuration
   # Ensure IPU6 is set to "Enabled"
   ```

2. **PCI Rescan**:
   ```bash
   # Force PCI bus rescan
   echo 1 | sudo tee /sys/bus/pci/rescan
   
   # Check again
   lspci -nn | grep -E "8086:a75d|8086:7d19"
   ```

3. **Power Management**:
   ```bash
   # Check if device is in power save mode
   lspci -vv | grep -A 20 "8086:a75d\|8086:7d19" | grep -i power
   ```

### Camera Hardware Not Recognized
**Symptoms**: No video devices created (`/dev/video*` missing)

**Solutions**:
```bash
# Check loaded kernel modules
lsmod | grep -E "(intel_ipu6|ipu6)"

# Expected modules for different camera types:
# GMSL: intel_ipu6_isys, intel_ipu6_psys
# IPU6: intel_ipu6_isys, intel_ipu6_psys, intel_ipu6
# MIPI: intel_ipu6_isys

# Manually load modules if missing
sudo modprobe intel-ipu6-isys
sudo modprobe intel-ipu6-psys

# Check for module loading errors
dmesg | grep -E "(ipu6|failed|error)" | tail -20
```

## GMSL Camera Troubleshooting

### GMSL Setup Script Issues
**Problem**: GMSL setup script fails to run

**Solutions**:
```bash
# Ensure script is executable
chmod +x gmsl.sh

# Run with verbose logging
./gmsl.sh 2>&1 | tee gmsl_install.log

# Check script log for errors
tail -f /tmp/intel_eci_setup_*.log

# Verify ECI repository access
ping eci.intel.com
curl -I https://eci.intel.com/packages/noble/
```

### GMSL Camera Detection Issues
**Problem**: GMSL cameras not detected after installation

**Solutions**:
1. **Check Physical Connections**:
   ```bash
   # Verify FAKRA connector seating
   # Check GMSL cable integrity
   # Ensure Add-in-Card is properly seated
   ```

2. **Verify Deserializer Communication**:
   ```bash
   # Check I2C communication with MAX9296A deserializer
   sudo dmesg | grep -E "(max929|i2c)"
   
   # Check for serializer detection
   sudo dmesg | grep max9295
   ```

3. **Camera Switch Configuration**:
   ```bash
   # Ensure D457 cameras are set to MIPI mode
   # Physical switch on back of camera should be in MIPI position
   ```

### GMSL-Specific Error Messages
**Error**: `FW authentication failed(-5)`
```bash
# Solution: Update firmware files
sudo apt update && sudo apt install --reinstall linux-firmware
sudo reboot
```

**Error**: `FW authentication failed(-110)`
```bash
# Solution: Check CONFIG_PM kernel configuration
grep CONFIG_PM /boot/config-$(uname -r)
# Should show: CONFIG_PM=y

# If not set, kernel rebuild may be required
```

**Error**: `max9296 not detected`
```bash
# Check Add-in-Card installation
lspci | grep -i multimedia

# Verify power to Add-in-Card
# Check PCIe slot compatibility (requires x4 minimum)
```

## IPU6 Camera Troubleshooting

### IPU6 Setup Script Issues
**Problem**: IPU6 setup script fails

**Solutions**:
```bash
# Ensure IPU6 userspace package is available
ls -la *IPU*.zip

# Run setup with verbose output
./setup_ipu6_camera.sh 2>&1 | tee ipu6_setup.log

# Check for missing dependencies
sudo apt update
sudo apt install -y alien fakeroot build-essential
```

### Kernel Installation Issues
**Problem**: Custom kernel 6.11.10 fails to install

**Solutions**:
```bash
# Check available disk space (minimum 5GB for kernel build)
df -h /

# Verify git access for kernel source
git clone https://github.com/intel/linux-intel-lts.git --depth 1 -b lts-v6.11.10-linux-240910T173009Z

# Check build dependencies
sudo apt install -y build-essential libncurses-dev bison flex libssl-dev libelf-dev
```

### IPU6 Package Installation Failures
**Problem**: RPM to DEB conversion fails

**Solutions**:
```bash
# Update alien package
sudo apt update && sudo apt install --reinstall alien

# Manual package conversion
alien --to-deb --scripts *.rpm

# Check converted packages
ls -la *.deb

# Install packages manually in correct order
sudo dpkg -i aiqb-ipu6epmtl_*.deb
sudo dpkg -i icamerasrc_*.deb
sudo dpkg -i libcamhal_*.deb
sudo dpkg -i libiaaiq-ipu6epmtl_*.deb
sudo dpkg -i libiacss-ipu6epmtl_*.deb
sudo dpkg -i ipu6epmtlfw_*.deb
```

### GRUB Configuration Issues
**Problem**: Kernel parameters not applied

**Solutions**:
```bash
# Check current kernel parameters
cat /proc/cmdline

# Verify GRUB configuration
grep -E "(i915.enable_guc|i915.max_vfs|i915.force_probe)" /etc/default/grub

# Manually update GRUB if needed
sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="[^"]*/& i915.enable_guc=3 i915.max_vfs=7 i915.force_probe=* udmabuf.list_limit=8192/' /etc/default/grub
sudo update-grub
sudo reboot
```

## MIPI Direct Camera Troubleshooting

### MIPI Camera Detection
**Problem**: Direct MIPI cameras not detected

**Solutions**:
```bash
# Check for MIPI CSI-2 interface
ls /dev/media*

# Verify media controller setup
media-ctl --list-devices

# Check for CSI-2 receiver
media-ctl --list-entities | grep csi

# Test with v4l2-ctl
v4l2-ctl --list-devices
```

### MIPI Configuration Issues
**Problem**: Incorrect lane configuration

**Solutions**:
```bash
# Check device tree or ACPI configuration
# For most Intel platforms, verify:
# - Lane count (typically 2 or 4 lanes)
# - Clock frequency
# - Pixel format support

# Check current media pipeline
media-ctl --print-topology
```

## Common Driver Issues

### DKMS Installation Problems
**Problem**: DKMS modules fail to build

**Solutions**:
```bash
# Check DKMS status
dkms status | grep ipu6

# View build logs
cat /var/lib/dkms/ipu6-drivers/*/build/make.log

# Common fixes:
# 1. Install matching kernel headers
sudo apt install linux-headers-$(uname -r)

# 2. Install build dependencies
sudo apt install dkms build-essential

# 3. Force rebuild
sudo dkms remove ipu6-drivers/1.0 --all
sudo dkms install ipu6-drivers/1.0

# 4. Check for kernel version compatibility
uname -r  # Should be 6.8+ for GMSL, 6.11+ for IPU6
```

### Module Loading Failures
**Problem**: Kernel modules won't load

**Solutions**:
```bash
# Check module dependencies
modinfo intel_ipu6_isys

# Load modules manually with debug
sudo modprobe -v intel_ipu6_isys

# Check for conflicts
lsmod | grep -E "(uvcvideo|cpia2|gspca)"

# Blacklist conflicting modules if needed
echo "blacklist uvcvideo" | sudo tee -a /etc/modprobe.d/blacklist-camera.conf
```

### Permission Issues
**Problem**: Camera devices not accessible

**Solutions**:
```bash
# Add user to video group
sudo usermod -a -G video $USER
sudo usermod -a -G render $USER

# Check device permissions
ls -la /dev/video*

# Fix permissions if needed
sudo chmod 666 /dev/video*

# Check udev rules
ls -la /lib/udev/rules.d/*realsense* /lib/udev/rules.d/*camera*

# Trigger udev rules
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=video4linux
```

## Firmware Problems

### Firmware Authentication Failures
**Problem**: IPU6 firmware fails to authenticate

**Solutions**:
```bash
# Check firmware files
find /usr/lib/firmware/intel/ipu* -name "*.bin*" | head -10

# Download alternative firmware
git clone https://github.com/intel/ipu6-camera-bins.git
sudo cp -r ipu6-camera-bins/ipu6* /usr/lib/firmware/intel/

# Check firmware loading in dmesg
sudo dmesg | grep -E "(firmware|authentication)"

# For unsigned firmware issues
echo "options intel_ipu6 enable_unsigned_fw=1" | sudo tee /etc/modprobe.d/ipu6.conf
sudo update-initramfs -u
```

### Missing Firmware Files
**Problem**: Required firmware files not found

**Solutions**:
```bash
# Install/reinstall firmware packages
sudo apt update
sudo apt install --reinstall linux-firmware
sudo apt install --reinstall intel-ipu6-firmware

# Manual firmware download for specific platforms
# For IPU6EPMTL (Arrow Lake):
wget https://github.com/intel/ipu6-camera-bins/raw/main/ipu6epmtl/intel/ipu6/ipu6_fw.bin
sudo cp ipu6_fw.bin /usr/lib/firmware/intel/ipu6/
```

## GStreamer and Application Issues

### GStreamer Plugin Problems
**Problem**: icamerasrc plugin not found

**Solutions**:
```bash
# Check plugin installation
gst-inspect-1.0 icamerasrc

# Verify plugin path
echo $GST_PLUGIN_PATH
ls -la /usr/lib/gstreamer-1.0/

# Refresh plugin cache
gst-inspect-1.0 --gst-plugin-path=/usr/lib/gstreamer-1.0

# Check library dependencies
ldd /usr/lib/gstreamer-1.0/libgsticamerasrc.so
```

### Camera Pipeline Issues
**Problem**: GStreamer pipeline fails

**Solutions**:
```bash
# Test basic pipeline with debug
GST_DEBUG=3 gst-launch-1.0 icamerasrc ! videoconvert ! autovideosink

# Test with specific device
gst-launch-1.0 icamerasrc device=/dev/video0 ! videoconvert ! autovideosink

# Check available formats
gst-launch-1.0 icamerasrc ! videoconvert ! video/x-raw,format=NV12 ! autovideosink

# Test with v4l2 fallback
gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! autovideosink
```

### RealSense Application Issues
**Problem**: rs-enumerate-devices finds no cameras

**Solutions**:
```bash
# Check RealSense installation
rs-enumerate-devices -s

# Test with specific backend
rs-enumerate-devices -B 3  # Use libUVC backend

# Check RealSense logs
RS_LOG_LEVEL=DEBUG rs-enumerate-devices

# Verify camera binding (for GMSL)
rs_ipu6_d457_bind.sh -n

# Test enumeration script
rs-enum.sh -n
```

## Performance and Optimization

### High CPU Usage
**Problem**: Excessive CPU usage during camera operations

**Solutions**:
```bash
# Monitor CPU usage
htop

# Check for software fallbacks
gst-launch-1.0 icamerasrc ! video/x-raw,format=NV12 ! vaapih264enc ! fakesink

# Enable hardware acceleration
export LIBVA_DRIVER_NAME=iHD
vainfo

# Optimize GStreamer pipeline
gst-launch-1.0 icamerasrc ! video/x-raw,width=640,height=480 ! videoconvert ! autovideosink
```

### Memory Issues
**Problem**: High memory usage or memory leaks

**Solutions**:
```bash
# Monitor memory usage
free -h
watch -n 1 'cat /proc/meminfo | grep -E "(MemTotal|MemFree|MemAvailable)"'

# Check for memory leaks in applications
valgrind --tool=memcheck --leak-check=full rs-enumerate-devices

# Optimize buffer settings
echo "options intel_ipu6_isys max_buffers=8" | sudo tee -a /etc/modprobe.d/ipu6.conf
```

### Frame Rate Issues
**Problem**: Low frame rates or dropped frames

**Solutions**:
```bash
# Check current frame rate
gst-launch-1.0 icamerasrc ! video/x-raw,framerate=30/1 ! fpsdisplaysink

# Test different resolutions
gst-launch-1.0 icamerasrc ! video/x-raw,width=640,height=480,framerate=30/1 ! autovideosink

# Check system performance
iostat -x 1
vmstat 1

# Optimize kernel parameters
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

## Advanced Debugging

### Kernel Debugging
```bash
# Enable dynamic debugging for IPU6
echo 'module intel_ipu6_isys +p' | sudo tee /sys/kernel/debug/dynamic_debug/control
echo 'module intel_ipu6_psys +p' | sudo tee /sys/kernel/debug/dynamic_debug/control

# Monitor kernel messages
sudo dmesg -w | grep -E "(ipu6|camera|video)"

# Check kernel ring buffer
sudo dmesg | grep -E "(ipu6|firmware|i2c)" | tail -50
```

### Media Controller Debugging
```bash
# Install media controller utilities
sudo apt install v4l-utils

# List all media devices
media-ctl --list-devices

# Show topology
media-ctl --print-topology

# Configure pipeline manually
media-ctl -d /dev/media0 --set-v4l2 '"Intel IPU6 CSI-2 0":0[fmt:SGRBG10_1X10/1920x1080]'
```

### I2C and Hardware Debugging
```bash
# Install I2C tools
sudo apt install i2c-tools

# List I2C buses
i2cdetect -l

# Scan for devices (be careful with this command)
# sudo i2cdetect -y <bus_number>

# Check GPIO states (if available)
cat /sys/kernel/debug/gpio

# Monitor interrupt activity
cat /proc/interrupts | grep -E "(ipu6|camera)"
```

## Recovery Procedures

### Complete System Reset
```bash
# Remove all camera-related packages
sudo apt remove --purge intel-ipu6-dkms ipu6* icamerasrc* libcamhal* realsense*

# Clean DKMS modules
sudo dkms remove ipu6-drivers --all
sudo rm -rf /var/lib/dkms/ipu6-drivers/

# Reset firmware
sudo rm -rf /usr/lib/firmware/intel/ipu*

# Clean configuration files
sudo rm -f /etc/modprobe.d/ipu6.conf
sudo rm -f /etc/profile.d/ipu6_env.sh

# Reset udev rules
sudo rm -f /lib/udev/rules.d/*realsense*

# Update initramfs
sudo update-initramfs -u

# Reboot system
sudo reboot
```

### Kernel Recovery
```bash
# List available kernels
ls /boot/vmlinuz-*

# Boot with different kernel via GRUB menu
# Hold Shift during boot to access GRUB menu

# Remove problematic kernel (if needed)
sudo apt remove linux-image-6.11.10-custom

# Reinstall original kernel
sudo apt install linux-image-generic
sudo update-grub
```

### Emergency Debugging Access
```bash
# Boot into recovery mode
# Select "Advanced options" in GRUB menu
# Choose "recovery mode"

# Check system status
systemctl status
journalctl -b -p err

# Network connectivity test
ping -c 4 google.com

# Filesystem check
sudo fsck -f /dev/sda1  # Replace with your root partition
```

## Log Collection for Support

### Comprehensive System Information
```bash
#!/bin/bash
# Create debug information package

DEBUG_DIR="camera_debug_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DEBUG_DIR"

# System information
uname -a > "$DEBUG_DIR/system_info.txt"
cat /etc/os-release >> "$DEBUG_DIR/system_info.txt"
lscpu >> "$DEBUG_DIR/system_info.txt"
free -h >> "$DEBUG_DIR/system_info.txt"
df -h >> "$DEBUG_DIR/system_info.txt"

# Hardware information
lspci -nn > "$DEBUG_DIR/hardware_info.txt"
lsusb >> "$DEBUG_DIR/hardware_info.txt"
lsmod | grep -E "(ipu6|camera)" >> "$DEBUG_DIR/hardware_info.txt"

# Kernel and driver information
dmesg | grep -E "(ipu6|camera|firmware)" > "$DEBUG_DIR/kernel_messages.txt"
dkms status > "$DEBUG_DIR/dkms_status.txt"

# Camera-specific information
ls -la /dev/video* > "$DEBUG_DIR/video_devices.txt" 2>/dev/null
v4l2-ctl --list-devices >> "$DEBUG_DIR/video_devices.txt" 2>/dev/null
media-ctl --list-devices >> "$DEBUG_DIR/video_devices.txt" 2>/dev/null

# Environment and configuration
env | grep -E "(GST|LIBVA)" > "$DEBUG_DIR/environment.txt"
cat /proc/cmdline > "$DEBUG_DIR/kernel_cmdline.txt"

# Package information
dpkg -l | grep -E "(ipu6|camera|realsense)" > "$DEBUG_DIR/installed_packages.txt"

# Create archive
tar -czf "${DEBUG_DIR}.tar.gz" "$DEBUG_DIR"
echo "Debug information collected in: ${DEBUG_DIR}.tar.gz"
```

## Quick Reference Commands

### System Health Check
```bash
# One-liner system check
echo "=== Camera System Health Check ==="; echo "OS: $(cat /etc/os-release | grep PRETTY_NAME)"; echo "Kernel: $(uname -r)"; echo "IPU6 Hardware: $(lspci -nn | grep -E '8086:a75d|8086:7d19')"; echo "Video Devices: $(ls /dev/video* 2>/dev/null | wc -l) devices"; echo "Loaded Modules: $(lsmod | grep -c ipu6)"; echo "DKMS Status: $(dkms status | grep ipu6)"
```

### Camera Test Pipeline
```bash
# Quick camera test
timeout 10s gst-launch-1.0 icamerasrc ! videoconvert ! autovideosink 2>/dev/null && echo "Camera test: PASS" || echo "Camera test: FAIL"
```

### Driver Reload
```bash
# Quick driver reload
sudo modprobe -r intel_ipu6_isys intel_ipu6_psys intel_ipu6; sleep 2; sudo modprobe intel_ipu6_isys
```

This troubleshooting guide covers the most common issues and their solutions for Intel camera systems. For persistent issues, collect the debug information and contact Intel support with your specific hardware configuration and error logs.
