#!/bin/bash -x
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Install Intel GPU compute-runtime and graphics compiler inside a container.
# Used only during Docker build — no host library mounts required.

set -e

INSTALL_DRIVER_VERSION="${INSTALL_DRIVER_VERSION:-26.09.37435}"

apt-get update && apt-get install -y --no-install-recommends libnuma1 ocl-icd-libopencl1 && rm -rf /var/lib/apt/lists/*

case $INSTALL_DRIVER_VERSION in
"26.09.37435")
    mkdir /tmp/gpu_deps && cd /tmp/gpu_deps
    curl -L -O https://github.com/intel/compute-runtime/releases/download/26.09.37435.1/libze-intel-gpu1_26.09.37435.1-0_amd64.deb
    curl -L -O https://github.com/intel/compute-runtime/releases/download/26.09.37435.1/intel-opencl-icd_26.09.37435.1-0_amd64.deb
    curl -L -O https://github.com/intel/compute-runtime/releases/download/26.09.37435.1/libigdgmm12_22.9.0_amd64.deb
    curl -L -O https://github.com/intel/compute-runtime/releases/download/26.09.37435.1/intel-ocloc_26.09.37435.1-0_amd64.deb
    curl -L -O https://github.com/intel/intel-graphics-compiler/releases/download/v2.30.1/intel-igc-core-2_2.30.1+20950_amd64.deb
    curl -L -O https://github.com/intel/intel-graphics-compiler/releases/download/v2.30.1/intel-igc-opencl-2_2.30.1+20950_amd64.deb
    dpkg -i ./*.deb && rm -Rf /tmp/gpu_deps
    ;;
*)
    echo "Error: unsupported INSTALL_DRIVER_VERSION=$INSTALL_DRIVER_VERSION"
    exit 1
    ;;
esac

apt-get clean && rm -rf /var/lib/apt/lists/* && rm -rf /tmp/*
