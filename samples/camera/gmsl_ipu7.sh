#!/bin/bash

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -Ee

# Simple logging helpers
ts() { date '+%Y-%m-%d %H:%M:%S'; }
info() { echo "[$(ts)] [INFO] $*"; }
warn() { echo "[$(ts)] [WARN] $*" >&2; }
error() { echo "[$(ts)] [ERROR] $*" >&2; }

trap 'error "Failed at line $LINENO: $BASH_COMMAND"' ERR

# Installed Deps
info "Installing build dependencies"
sudo apt install quilt libssl-dev kernel-wedge liblz4-tool libelf-dev flex bison git libdw-dev

# Build Debian Package
info "Cloning linux-kernel-overlay"
sudo git clone https://github.com/intel/linux-kernel-overlay.git
info "Entering repo folder"
cd linux-kernel-overlay
TAG="mainline-tracking-overlay-pre-prod-v6.17-ubuntu-251118T134731Z"
info "Checking out tag: ${TAG}"
sudo git checkout $TAG

info "Building kernel overlay packages"
sudo ./build.sh -r no -t $TAG -b 1000 -c mainline-tracking

# Install 
info "Downloading installer.sh"
curl -L -o installer.sh 'https://cdrdv2.intel.com/v1/dl/getContent/860689/871556?filename=installer.sh'
info "Making installer.sh executable"
chmod +x installer.sh

info "Downloading firmware zip"
curl -L -o PTL-H_IPU_FW-HDMI-in_Beta.zip 'https://cdrdv2.intel.com/v1/dl/getContent/860689/871555?filename=PTL-H_IPU_FW-HDMI-in_Beta.zip'

info "Running installer.sh"
sudo ./installer.sh UBUNTU_NOBLE PTL mainline-tracking-overlay-pre-prod-v6.17-ubuntu-251118T134731Z default

info "Unzipping firmware bundle"
sudo unzip PTL-H_IPU_FW-HDMI-in_Beta.zip

info "Installing alien"
sudo apt install alien
info "Converting RPMs to DEBs"
sudo alien -- ./*.rpm
info "Installing generated DEB packages"
sudo dpkg -i --force-overwrite icamerasrc-*.deb
sudo dpkg -i --force-overwrite ipu7xfw-*.deb
sudo dpkg -i --force-overwrite libiaaiq-ipu75xa-*.deb
sudo dpkg -i --force-overwrite libiaaiq-ipu7x-*.deb
sudo dpkg -i --force-overwrite ipu75xafw-*.deb
sudo dpkg -i --force-overwrite libcamhal-*.deb

# change the permissions of the files to be executable
info "Fixing permissions on installed .so files"
sudo chmod +x /usr/lib/x86_64-linux-gnu/libiaaiq-ipu75xa.so
sudo chmod +x /usr/lib/x86_64-linux-gnu/libiaaiq-ipu7x.so
sudo chmod +x /usr/lib/x86_64-linux-gnu/libcamhal.so

warn "Rebooting system now"
sudo reboot