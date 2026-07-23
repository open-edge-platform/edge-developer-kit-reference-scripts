# Getting Started with Intel® Edge Developer Kits

Welcome to Intel®'s edge computing ecosystem! This guide will help you get up and running quickly, regardless of your experience level.

## Table of Contents

- [Installation Walkthrough](#installation-walkthrough)
- [Unattended Installation](#unattended-installation)
- [Optional: Install DL Streamer](#optional-install-dl-streamer)
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

## Unattended Installation

When the kernel needs upgrading, the default flow stops and asks you to reboot and run the installer again. `DEVKIT_AUTO_INSTALL=1` does it in one pass instead:

```bash
sudo DEVKIT_AUTO_INSTALL=1 ./main_installer.sh
```

> **This restarts your system** after a ten second countdown. Press Ctrl+C to cancel.

Driver packages are user-space and install fine on the old kernel, so only verification is deferred. It runs automatically on the next boot:

```bash
sudo tail -40 /var/log/intel-platform-installer.log
```

In the default flow, the installer instead ends with a summary of what needs a restart and why, shown only when one is actually required.

## Optional: Install DL Streamer

[Intel® Deep Learning Streamer](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer/index.html) adds GStreamer elements such as `gvadetect`, `gvaclassify` and `gvawatermark`, letting you build media analytics pipelines on CPU, GPU and NPU.

It is not part of the base install. Run it after the main installer has completed, since it relies on the GPU and NPU drivers already being in place:

```bash
sudo ./dlstreamer_installer.sh
```

To install a specific release instead of the latest:

```bash
sudo DLSTREAMER_VERSION=2026.1.0 ./dlstreamer_installer.sh
```

List what is available with `apt show -a intel-dlstreamer`.

**About the environment variables**

DL Streamer needs a set of GStreamer variables that the upstream guide asks each user to paste into their own `~/.bashrc`. This installer instead writes `/etc/profile.d/intel-dlstreamer.sh`, which sources the environment script shipped by the package. The variables are then set for every user at login, with nothing to edit per user and no paths duplicated.

It applies at your next login. To use it in the shell you already have open:

```bash
source /etc/profile.d/intel-dlstreamer.sh
```

**Verify**

```bash
gst-inspect-1.0 gvadetect
```

You should see the element documentation rather than `No such element`. If you do not, log out and back in so the environment is applied.

**Run a sample pipeline**

Download a model, then run a detection pipeline against it:

```bash
/opt/intel/dlstreamer/samples/download_public_models.sh yolo11s

export MODEL=$MODELS_PATH/public/yolo11s/FP16/yolo11s.xml
gst-launch-1.0 videotestsrc num-buffers=100 ! video/x-raw,width=640,height=640 ! \
  videoconvert ! gvadetect model=$MODEL device=CPU ! gvafpscounter ! fakesink
```

`MODELS_PATH` defaults to `~/models` and is set for you by the profile script. A frames-per-second figure followed by `Got EOS` means inference is working. Swap `device=CPU` for `device=GPU` to exercise the GPU path.

> **Note:** Intel also ships `/opt/intel/dlstreamer/scripts/hello_dlstreamer.sh`. On systems with more than one GPU it fails with `[: too many arguments`, because its GPU detection does not quote the result of `find /dev/dri/ -name "render*"`. The pipeline above avoids it.

> **Note:** `intel-dlstreamer` depends on a specific OpenVINO™ version. If `openvino_installer.sh` has already installed a different one, the installer warns you and prints the commands to remove the conflicting packages.

### Next Steps

Explore all samples — browse everything available [here](../samples/SAMPLES_README.md), share your projects and help others learn!