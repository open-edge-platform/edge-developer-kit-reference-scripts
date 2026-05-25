# Setup Central Monitoring System Server

## Overview

This guide explains how to setup all the services required on the Central Monitoring System Server. This server is the central data ingest and storage endpoint for patient telemetry. It runs InfluxDB in Docker container and receives upstream data forwarded from the Patient Monitoring Hub.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Get Started](#get-started)
- [What setup.sh Does](#what-setupsh-does)
- [Next Step](#next-step)

## Prerequisites

1. Ubuntu 24.04 system.
2. Network reachability from Patient Monitoring Hub to this server.
3. Use the same subnet as the Proxmox host during initial setup.

## Get Started

1. Clone repository:

    ```bash
    git clone https://github.com/open-edge-platform/edge-developer-kit-reference-scripts
    ```

2. Change directory:

    ```bash
    cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/server
    ```

3. Run setup script:

    ```bash
    bash setup.sh
    ```

4. If prompted to apply Docker group membership, run one this and then run the setup script again:

    ```bash
    newgrp docker
    bash setup.sh
    ```

5. Save the printed `SERVER_TOKEN` value. You must place this token in the Patient Monitoring Hub token file later.

## What `setup.sh` Does

The `setup.sh` script performs these actions:

1. Installs Docker prerequisites: `ca-certificates` and `curl`.
2. Adds Docker apt repository and installs:
    - `docker-ce`
    - `docker-ce-cli`
    - `containerd.io`
    - `docker-buildx-plugin`
    - `docker-compose-plugin`
3. Enables and starts Docker service.
4. Adds the current user to the `docker` group when needed.
5. Creates Python virtual environment `server_env`.
6. Installs Python dependency.
7. Starts InfluxDB container from `docker-compose.yml`.
8. Waits for InfluxDB health endpoint to become ready.
9. Initializes InfluxDB
10. Creates local Influx CLI profile and prints `SERVER_TOKEN`.

## Next Step

[Setup Monitoring Hub (Ubuntu LXC)](./monitoring_hub_setup.md)