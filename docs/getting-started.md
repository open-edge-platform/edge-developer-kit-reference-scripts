# Getting Started with Intel® Edge Developer Kits

Welcome to Intel®'s edge computing ecosystem! This guide will help you get up and running quickly, regardless of your experience level.

## Table of Contents

- [Installation Walkthrough](#installation-walkthrough)
- [Next Steps](#next-steps)

## Installation Walkthrough

### Step 1: Prepare Your System

**Required:**
- Ubuntu* 24.04 LTS Desktop ([Download](https://releases.ubuntu.com/noble/))
- Internet connection
- Administrator (sudo) access

**Recommended:**
- 16GB RAM minimum
- 100GB free disk space
- Supported Intel® hardware ([Check compatibility](../README.md/#validated-hardware--configurations))

### Step 2: Enable Hardware Features

**For Intel® Arc™ Graphics:**
1. Access BIOS/UEFI settings
2. Enable "Resizable BAR" or "Above 4G Decoding"
3. Save and reboot

> **Why?** This significantly improves GPU performance with large AI models.

### Step 3: Run the Installer

**Option A: One-Line Install (Recommended)**
```bash
sudo bash -c "$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)"
```

**Option B: Step-by-Step Install**
```bash
# Download the repository
git clone https://github.com/open-edge-platform/edge-developer-kit-reference-scripts.git
cd edge-developer-kit-reference-scripts

# Run main installer
sudo ./main_installer.sh
```

### Step 4: Handle Reboot (if prompted)

Some driver installations require a reboot. If prompted:

1. Reboot your system
2. Return to the installation directory
3. Run the post-reboot commands:

```bash
sudo ./openvino_installer.sh
sudo ./print_summary_table.sh
```

### Step 5: Verify Installation

You should see output like this:

Installation is completed when you see this message:

 ```
========================================================================
Running Installation Summary

==================== System Installation Summary ====================
Item                      | Value
------------------------ -+-----------------------------------------
Kernel Version            | 6.14.0-27-generic
HWE Stack                 | Installed
Ubuntu Version            | Ubuntu 24.04.3 LTS
NPU Status                | Detected
NPU Package               | intel-level-zero-npu
NPU Version               | 1.19.0.20250707-16111289554
intel-driver-compiler-npu | 1.19.0.20250707-16111289554
intel-fw-npu              | 1.19.0.20250707-16111289554
intel-level-zero-npu      | 1.19.0.20250707-16111289554
level-zero                | 1.22.4
GPU Type                  | Intel
GPU Count                 | 4 Intel graphics device(s) detected
GPU Driver                | i915 (loaded)
GPU Device 1              | 00:02.0 VGA compatible controller: Intel Corporation Arrow Lake-U [Intel Graphics] (rev 06)
GPU Device 2              | 03:00.0 VGA compatible controller: Intel Corporation Device e20b
GPU Device 3              | 08:00.0 VGA compatible controller: Intel Corporation Device e20b
GPU Device 4              | 80:14.5 Non-VGA unclassified device: Intel Corporation Device 7f2f (rev 10)
------------------------ -+-----------------------------------------
Intel Graphics Packages   |
------------------------ -+-----------------------------------------
i965-va-driver:amd64      | 2.4.1+dfsg1-1build2
intel-gsc                 | 0.9.5-0ubuntu1~24.04~ppa1
intel-media-va-driver-non-free:amd64 | 25.3.1-0ubuntu1~24.04~ppa1
intel-opencl-icd          | 25.27.34303.9-1~24.04~ppa1
libegl-mesa0:amd64        | 25.0.7-0ubuntu0.24.04.1
------------------------ -+-----------------------------------------
Platform Status           | [✓] Platform is configured
=====================================================================

========================================================================
Installation completed: 2025-08-11 10:11:54
Log file saved: /var/log/intel-platform-installer.log
========================================================================
```

**🎉 Congratulations!** You're now ready to build amazing AI applications with Intel® hardware.

### Next Steps

Explore all samples — browse everything available [here](../samples/SAMPLES_README.md), share your projects and help others learn!
