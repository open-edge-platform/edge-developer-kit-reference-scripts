# IPU7 GMSL Camera Quick Start Guide

## Introduction

This document is a draft Quick Start Guide (QSG) for bringing up an IPU7-based GMSL camera pipeline on Ubuntu* 24.04 using the scripts in this repository.

Scope:
- Hardware: an IPU7-capable Intel® platform, a GMSL add-in card (AIC), and GMSL cameras.


> Note: BIOS menus and exact settings vary by platform vendor.

## Table of Contents

- [Introduction](#1-introduction)
- [Table of Contents](#2-table-of-contents)
- [System requirements](#3-system-requirements)
- [Hardware Setup and Connections](#5-hardware-setup-and-connections)
- [BIOS configuration](#6-bios-configuration)
- [Software QSG](#7-software-qsg)
- [Support and Documentation](#8-support-and-documentation)
- [Trademarks](#trademarks)

## System requirements

### Operating system

- Ubuntu 24.04 (Noble Numbat)

### Kernel

- 6.17+ for Intel® Core™ Ultra Processors (Series 3)

### Hardware

- CPU/platform: Intel® Core™ Ultra Processors (Series 3)
- Memory: 8 GB RAM minimum (16 GB recommended for multi-camera, 64GB recommended for multi-camera with AI application)
- Storage: Minimum of 256 GB free disk space
- GMSL cameras and GMSL Max96724 AIC card
- Network access to download packages and keys

## Hardware Setup and Connections

1. Power off the system and disconnect AC power.
2. Install the GMSL AIC into an appropriate MIPI CSI-2 slot.
3. Connect GMSL cameras to the AIC as recommended in the image below.

![GMSL AIC and camera cabling example](assets/gmslconnections.png)

4. Reconnect power and boot the system.

## BIOS configuration

> Note: BIOS menus and exact settings vary by platform vendor and camera sensor.

BIOS options are platform-specific. Configure the platform BIOS to enable the IPU7 and the Intel GMSL SERDES ACPI devices as required in the System Agent (SA) Configuration.

1. Enable IPU and NPU device. 
![Enable IPU device](assets/1.jpg)

2. Navigate to MIPI Camera Configuration
![Go to MIPI config](assets/2.jpg)

> Note: Only enable Camera1 for 4 cameras configuration.

3. Enable Camera1 and Camera2 for 8 cameras configuration. 
![cam1 config](assets/3.jpg)

4. In Camera1 menu, apply all the necessary config for MIPI Port A.
![cam1 config1](assets/4.jpg)
![cam1 config2](assets/5.jpg)

5. In Camera2 menu, apply all the necessary config for MIPI Port C.
![cam2 config1](assets/6.jpg)
![cam2 config2](assets/7.jpg)

6. Press F4 to save the changes and navigate to the main BIOS menu page to continue.
System will go into reboot state. 


## Software QSG

1. Ensure you follow this guide [Intel® Core™ Ultra Processors (Series 3) RDC](https://cdrdv2.intel.com/v1/dl/getContent/858119/view) to boot up the system. 

After reboot, perform basic checks:

```bash
# Kernel
uname -r

# IPU6 device detection
lspci -nn | grep -E "8086:a75d|8086:7d19" || true

# Kernel modules (module names can vary by release)
lsmod | grep -i ipu || true

```

2. Ensure the camera devices are enumerated successfully.

3. Use the commands below to stream.

Notes:
- For multi-camera, set `num-vc` to the total number of cameras (4 or 8) for each `icamerasrc` instance.
- Use `device-name=isx031-<N>` (for example, `isx031-1`, `isx031-2`, and so on).

### Single camera (1)

```bash
gst-launch-1.0 icamerasrc num-buffers=600 scene-mode=auto device-name=isx031-1 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false
```

### 4 cameras

```bash
gst-launch-1.0 \
	icamerasrc num-vc=4 num-buffers=600 scene-mode=auto device-name=isx031-1 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=4 num-buffers=600 scene-mode=auto device-name=isx031-2 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=4 num-buffers=600 scene-mode=auto device-name=isx031-3 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=4 num-buffers=600 scene-mode=auto device-name=isx031-4 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false
```

### 8 cameras

```bash
gst-launch-1.0 \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-1 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-2 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-3 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-4 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-5 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-6 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-7 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false \
	icamerasrc num-vc=8 num-buffers=600 scene-mode=auto device-name=isx031-8 io-mode=dma_mode printfps=true ! 'video/x-raw(memory:DMABuf),drm-format=UYVY,width=1920,height=1536' ! glimagesink sync=false
```

If you are blocked:
- Capture `uname -r`, `lspci -nn`, and relevant `dmesg` excerpts.
- Include BIOS version and the exact AIC + camera model/firmware revisions.

## Trademarks

Ubuntu* is a trademark of Canonical Ltd.