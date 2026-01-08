# Intel IPU6 Camera Setup Scripts

This directory contains scripts for setting up Intel IPU6 camera support on Ubuntu systems, specifically for Intel ARL (Arrow Lake) development kits.

## Prerequisites

- Ubuntu 24.04 LTS
- Intel ARL (Arrow Lake) hardware with IPU6
- Sudo privileges
- Internet connection for downloading packages
- IPU6 userspace package (ARL-UH_IPU_FW_HDMI-in.zip) from Intel

## Quick Start

1. **Download the IPU6 userspace package** from Intel:
   ```
   https://www.intel.com/content/www/us/en/secure/design/confidential/software-kits/kit-details.html?kitId=831484
   ```

2. **Download and run the setup script:**
   ```bash
   # Download and execute the main setup script directly
   wget -O- https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/usecases/camera/mipi/mipi.sh | bash
   ```

### Multiple Camera Support

For multiple cameras, check available devices:
```bash
v4l2-ctl --list-devices
gst-launch-1.0 icamerasrc device=/dev/video0 ! ...
gst-launch-1.0 icamerasrc device=/dev/video2 ! ...
```

## Disclaimer

This script is provided "as-is" without warranty of any kind. Always test in a development environment before production deployment. Intel, RealSense, and other trademarks are property of their respective owners.
