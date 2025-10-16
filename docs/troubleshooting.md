## Troubleshooting Guide

## Table of Contents

- [Common Issues](#common-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Log Files & Troubleshooting Steps](#log-files--troubleshooting-steps)
- [Intel® Camera Systems Troubleshooting Guide](../usecases/camera/TROUBLESHOOTING.md)

### Common Issues

**Wrong Kernel Version:**
```bash
✗ Unsupported kernel version: 6.8.x
This installer requires kernel 6.11.x
Please install HWE kernel: sudo apt install linux-generic-hwe-24.04
```

**Permission Error:**
```bash
✗ This script must be run with sudo or as root user
```

### Platform-Specific Issues

**Platform Not Detected:**
- Check `/sys/class/dmi/id/product_name`
- Add to appropriate platform list

**NPU Not Detected:**
- Confirm you are using an Intel® Core™ Ultra platform
- Check for NPU device: `ls /dev/intel-npu*`
- If missing, reboot the system and rerun the installer

**GPU Issues:**
- Run the GPU installer separately: `./gpu_installer.sh`
- Verify GPU detection: `lspci | grep -i vga`
- If issues persist, check for error messages in the terminal and review relevant log files
- Reboot the system after driver installation if prompted

### Log Files & Troubleshooting Steps

During installation, logs are displayed in real time. For deeper troubleshooting, consult these sources:

- **APT Package Logs:** `/var/log/apt/`
- **Docker* Logs:** `docker logs [container_name]`
- **NPU Driver Logs:** `/var/log/intel-npu.log`
- **Installer Output:** Review terminal messages for errors or warnings

**Troubleshooting Checklist:**
- Review relevant log files for error details
- Confirm your hardware matches the supported platforms
- Test individual installer scripts (e.g., `gpu_installer.sh`, `npu_installer.sh`)
- Search for known issues in [GitHub Issues](https://github.com/intel/edge-developer-kit-reference-scripts/issues)
- When reporting a bug, include platform model, OS version, and log excerpts

For further assistance, open an issue on GitHub with detailed information.
