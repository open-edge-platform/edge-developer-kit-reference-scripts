#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# This script install MQTT broker and client in the Ubuntu LXC container for the patient monitoring hub.

GREEN='\033[0;32m'
NC='\033[0m'
TICK="${GREEN}\u2714${NC}"

set -e

# Install docker
echo "Installing Docker..."
apt update
apt install -y ca-certificates curl jq
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# shellcheck disable=SC1091
ubuntu_suite=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${ubuntu_suite}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
systemctl enable docker
systemctl start docker
echo -e "${TICK} Docker installed successfully."