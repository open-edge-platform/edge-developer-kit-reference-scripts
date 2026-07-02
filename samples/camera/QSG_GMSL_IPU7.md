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

## BIOS configuration

> Note: BIOS menus and exact settings vary by platform vendor and camera sensor.

BIOS options are platform-specific. Configure the platform BIOS to enable the IPU7 and the Intel GMSL SERDES ACPI devices as required in the System Agent (SA) Configuration.

### Platform-Specific BIOS Configuration

| Platform/Vendor | BIOS Configuration Guide |
|---|---|
| [Innodisk Intel® Core™ Ultra Series 3 Reference Kit](https://www.innodisk.com/en/blog/intel-core-ultra-series3-reference-kit) | [PTL Innodisk Island BIOS Configuration](GMSL_INNODISK_BIOS_CONFIG.md)<br>[Robinson GMSL BIOS Configuration](GMSL_ROBINSON_BIOS_CONFIG.md) |


## Software QSG

1. Ensure you follow this guide [Intel® Core™ Ultra Processors (Series 3) RDC](https://cdrdv2.intel.com/v1/dl/getContent/858119/view) to boot up the system. 

After reboot, perform basic checks:

```bash
# Kernel
uname -r

# IPU6 device detection
lspci -nn | grep -i -E 'ipu|image'

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