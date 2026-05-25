#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

GREEN='\033[0;32m'
NC='\033[0m'
TICK="${GREEN}\u2714${NC}"

set -e

# Bring up docker containers for MQTT broker and client
echo "Bringing up MQTT broker and client using Docker Compose..."
cd /root/monitoring_hub

# Bring up the MQTT broker and InfluxDB containers first
docker compose up -d influxdb mqtt-broker
echo "Waiting for containers to be running..."

timeout=60
elapsed=0

while [ $elapsed -lt $timeout ]; do
    all_running=true

    for container in mqtt-broker influxdb; do
        state=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)
        if [ "$state" != "true" ]; then
            all_running=false
            break
        fi
    done

    if $all_running; then
        echo -e "${TICK} All containers are running."
        break
    fi

    sleep 2
    elapsed=$((elapsed + 2))
done

if [ $elapsed -ge $timeout ]; then
    echo "Error: Timeout waiting for containers"
    exit 1
fi

# Setup influxdb configuration
echo "Setting up InfluxDB configuration..."

until docker exec influxdb curl -sf http://127.0.0.1:8086/health >/dev/null; do
  sleep 2
done

TOKEN_FILE="/root/monitoring_hub/influxdb_token.env"

is_token_present() {
  [ -f "$TOKEN_FILE" ] && \
  grep -q '^HUB_TOKEN=.' "$TOKEN_FILE"
}

echo "Checking InfluxDB setup via token file..."

if is_token_present; then
  echo "HUB_TOKEN already exists. Skipping InfluxDB setup."
else
  echo "No HUB_TOKEN found. Running InfluxDB setup..."

  docker exec influxdb influx setup \
    --host http://127.0.0.1:8086 \
    --username user \
    --password password \
    --org hospital \
    --bucket patient_data \
    --retention 5d \
    --force

  echo "Retrieving InfluxDB token..."
  HUB_TOKEN=$(docker exec influxdb influx auth list \
    --host http://127.0.0.1:8086 \
    --org hospital \
    --json | jq -r '.[0].token')

  if [ -z "$HUB_TOKEN" ] || [ "$HUB_TOKEN" = "null" ]; then
    echo "ERROR: Failed to retrieve InfluxDB token"
    exit 1
  fi

  sed -i "s|^HUB_TOKEN=.*|HUB_TOKEN=$HUB_TOKEN|" "$TOKEN_FILE"
  echo "Token saved to $TOKEN_FILE"
fi

# Lastly, bring up the MQTT → InfluxDB bridge container
echo "Starting MQTT → InfluxDB bridge..."
docker compose up -d mqtt-influx-bridge
sleep 5
# Check if the bridge container is running
if [ "$(docker inspect -f '{{.State.Running}}' mqtt-influx-bridge 2>/dev/null || echo false)" != "true" ]; then
  echo "Error: MQTT → InfluxDB bridge container failed to start"
  exit 1
fi
echo -e "${TICK} Bridge started successfully"