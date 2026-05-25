#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

GREEN='\033[0;32m'
NC='\033[0m'
TICK="${GREEN}\u2714${NC}"

# Install docker
echo "Installing Docker..."
sudo apt update
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

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
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
sudo systemctl enable docker
sudo systemctl start docker
echo -e "${TICK} Docker installed successfully."

# Add current user to docker group to allow running docker without sudo
if id -Gn | grep -q docker; then
    echo -e "${TICK} User is already in docker group. Continuing..."
else
    echo "Adding current user to docker group..."
    sudo usermod -aG docker "$USER"
    echo -e "${TICK} User added to docker group."
    echo ""
    echo "To apply the docker group membership, please run \`newgrp docker\`"
    echo ""
    echo "Then re-run this script to continue setup."
    exit 0
fi

# Create python virtual environment and install dependencies
echo "Setting up Python virtual environment and installing dependencies..."
sudo apt install python3-venv -y
python3 -m venv server_env
# shellcheck disable=SC1091
source server_env/bin/activate
pip install --upgrade pip
pip install influxdb-client==1.50.0
echo -e "${TICK} Python virtual environment set up and dependencies installed successfully."

# Bring up docker container for influxdb
echo "Bringing up Server InfluxDB using Docker Compose..."
docker compose up -d
echo "Waiting for InfluxDB to be ready..."

# Wait for InfluxDB to be listening on port 8086
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if docker exec influxdb curl -s http://localhost:8086/health > /dev/null 2>&1; then
        echo -e "${TICK} InfluxDB is ready."
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    echo -e "\033[1;31mError: InfluxDB failed to start after 30 seconds\033[0m"
    exit 1
fi

echo -e "${TICK} Server InfluxDB is up and running."

# Setup database
echo "Setting up InfluxDB database, bucket, and user..."
docker exec -it influxdb influx setup \
 --username user \
 --password password \
 --org hospital \
 --bucket patient_data \
 --retention 5d \
 --force
echo -e "${TICK} InfluxDB setup complete."

# Test InfluxDB connection
echo "Testing InfluxDB connection..."
docker exec -it influxdb influx ping
echo -e "${TICK} InfluxDB connection successful."

# Set config before get token
docker exec influxdb influx config create --config-name hospital-admin --host-url http://localhost:8086 --org hospital --username-password user:password --active

# Get TOKEN for InfluxDB
SERVER_TOKEN=$(docker exec influxdb influx auth list --org hospital --json | jq -r '.[0].token')
# Check if token retrieval failed
if [ -z "$SERVER_TOKEN" ] || [ "$SERVER_TOKEN" = "null" ]; then
    echo -e "\033[1;31mError: Failed to retrieve InfluxDB token\033[0m"
    exit 1
else 
    echo -e "${TICK} InfluxDB token retrieved successfully."
    echo "SERVER_TOKEN=${SERVER_TOKEN}"
    echo -e "\033[1;31m!!\033[0m Please save the SERVER_TOKEN value above, as it will be needed for the bridge application to connect to the Server InfluxDB instance."
fi