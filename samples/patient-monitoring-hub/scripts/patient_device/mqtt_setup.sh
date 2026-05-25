#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Install Docker and paho-mqtt for MQTT client in patient device
# Add Docker's official GPG key:
echo "Installing Docker and paho-mqtt for MQTT client in patient device..."
sudo apt update
sudo apt install ca-certificates curl -y
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
# shellcheck disable=SC1091
ubuntu_suite=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${ubuntu_suite}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
# Install Docker Engine, CLI, containerd, and Docker Compose plugin:
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
sudo systemctl enable docker
sudo systemctl start docker
echo "Docker installed and started successfully."

# install paho-mqtt for MQTT client in patient device
echo "Installing paho-mqtt for MQTT client in patient device..."
sudo apt install python3-pip python3-venv -y
python3 -m venv mqtt_venv
# shellcheck disable=SC1091
source mqtt_venv/bin/activate
pip install paho-mqtt
echo "paho-mqtt installed successfully."

# Synchronize time
echo "Synchronizing time on patient device..."
export DEBIAN_FRONTEND=noninteractive
sudo apt update
sudo apt install locales -y
sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8
timedatectl status
timedatectl set-ntp true
sudo apt-get install -y chrony
sudo systemctl enable --now chrony
chronyc tracking
chronyc sources -v
echo "Time synchronized successfully."

# Add current user to docker group to allow running docker without sudo
if id -Gn | grep -q docker; then
	echo "User is already in docker group."
else
	echo "Adding current user to docker group..."
	sudo usermod -aG docker "$USER"
	echo "User added to docker group."
	echo "To apply the docker group membership, run 'newgrp docker' or log out and back in."
fi

echo "MQTT client setup completed successfully on patient device."
