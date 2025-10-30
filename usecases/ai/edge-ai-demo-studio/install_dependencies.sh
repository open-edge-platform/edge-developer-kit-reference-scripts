#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

if [ -z "${SUDO_USER:-}" ]; then
  echo "Error: SUDO_USER is not set. Please run this script with sudo from a non-root user account."
  exit 1
fi

install_system_dependencies() {
  echo "Installing system dependencies ..."
  apt update -y
  apt install -y \
    curl \
    wget \
    libxml2 \
    git \
    software-properties-common 
}

download_espeak_ng() {
    if dpkg -s espeak-ng &> /dev/null; then
        echo "espeak-ng is already installed via apt."
    else
        echo "Installing espeak-ng via apt ..."
        apt update -y
        apt install -y espeak-ng espeak-ng-data libsndfile1
    fi
}


main() {
  install_system_dependencies
  download_espeak_ng
}

main
