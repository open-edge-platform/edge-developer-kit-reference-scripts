#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# This script sets up an Ubuntu LXC container for the patient monitoring hub.

# Download the Ubuntu LXC image
pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst

# Create the LXC container
pct create 102 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
  --hostname ubuntu-lxc \
  --memory 2048 \
  --rootfs local-lvm:8 \
  --cores 2 \
  --net0 name=eth0,bridge=vmbr1,ip=dhcp \
  --unprivileged 0 \
  --onboot 1

# Append the necessary configuration to the container's config file
tee -a /etc/pve/lxc/102.conf >/dev/null <<'EOL'
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop: 
lxc.mount.auto: "proc:rw sys:rw"
EOL

# Start the LXC container
pct start 102
echo "Ubuntu LXC container created and started successfully."

# Configure locale and time synchronization inside Ubuntu LXC 102
echo "Configuring locale and time synchronization in container 102..."
pct exec 102 -- bash -lc '
export DEBIAN_FRONTEND=noninteractive
apt update
apt install locales -y
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8
timedatectl status
timedatectl set-ntp true
apt-get install -y chrony
systemctl enable --now chrony
chronyc tracking
chronyc sources -v
'
echo "Locale and time synchronization completed for container 102."

# Copy the patient monitoring hub code into the container
echo "Copying patient monitoring hub code into container 102..."
cd ~/edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/ || exit
tar -czf monitoring_hub.tar.gz monitoring_hub
pct push 102 monitoring_hub.tar.gz /root/monitoring_hub.tar.gz
pct exec 102 -- tar -xzf /root/monitoring_hub.tar.gz -C /root/

echo "Setup of Ubuntu LXC container 102 completed successfully."