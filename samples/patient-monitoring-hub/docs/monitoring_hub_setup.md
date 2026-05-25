# Setup Monitoring Hub (Ubuntu) LXC Container on Proxmox Host

## Overview

This guide explains how to setup Monitoring Hub (Ubuntu) LXC container on Promox host (Patient Monitoring Hub). The Monitoring Hub container receives patient telemetry from connected patient monitoring devices, stores data in local InfluxDB database, and forwards data to the centralized database at Central Monitoring System Server. This enables reliable local ingest with upstream synchronization for nurses' station visibility.

## Table of Contents

- [Get Started](#get-started)
- [What the Scripts Do](#what-the-scripts-do)
  - [setup_ubuntu_lxc.sh](#setup_ubuntu_lxcsh)
  - [setup.sh](#setupsh)
  - [start.sh](#startsh)
- [Verify After Setup](#verify-after-setup)
- [Next Step](#next-step)

## Get Started

1. Log in to the Proxmox host.
2. Change to script directory:

	```bash
	cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/monitoring_hub/
	```

3. Create the Ubuntu LXC container:

	```bash
	bash setup_ubuntu_lxc.sh
	```

4. Enter container `102`:

	```bash
	pct enter 102
	```

5. Change to Monitoring Hub directory:

	```bash
	cd /root/monitoring_hub
	```

6. Install Docker and dependencies:

	```bash
	bash ./setup.sh
	```

7. Edit `/root/monitoring_hub/influxdb_token.env` and update:
	- `SERVER_INFLUXDB_URL` (for example, `http://<SERVER_IP>:8086`)
	- `SERVER_TOKEN`

	You can get `SERVER_TOKEN` from the server setup here: [Setup Central Monitoring System Server](./server_setup.md).

8. Start Monitoring Hub services:

	```bash
	bash ./start.sh
	```

## What the Scripts Do

### setup_ubuntu_lxc.sh

Creates and configures Ubuntu LXC container `102` with:
- 2 GB RAM and 2 CPU cores
- DHCP network on `vmbr1`
- Locale and time sync (`chrony`)
- Monitoring Hub scripts copied to `/root/monitoring_hub`

### setup.sh

Installs Docker runtime and required dependencies inside the container:
- `ca-certificates`, `curl`, `jq`
- Docker Engine, CLI, Buildx, and Compose plugin
- Enables and starts Docker service

### start.sh

Starts and validates Monitoring Hub services:
- Starts `influxdb` and `mqtt-broker` containers
- Waits until both containers are running
- Waits for local InfluxDB health endpoint
- If `HUB_TOKEN` is empty, initializes local InfluxDB and writes `HUB_TOKEN` into `influxdb_token.env`
- Starts `mqtt-influx-bridge` and validates container state

## Verify After Setup

Inside container `102`, verify services are running:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker exec influxdb curl -sf http://127.0.0.1:8086/health
```

Expected: Containers `influxdb`, `mqtt-broker`, and `mqtt-influx-bridge` are `Up`, and the health check succeeds.

Verify token configuration:

```bash
grep -E '^HUB_TOKEN=|^SERVER_INFLUXDB_URL=|^SERVER_TOKEN=' /root/monitoring_hub/influxdb_token.env
```

Expected: All three variables have non-empty values.

To exit from monitoring hub terminal, type `exit`

## Next Step

[Connect and configure Patient Monitoring Device](./patient_device.md)