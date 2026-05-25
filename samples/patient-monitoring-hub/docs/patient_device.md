# Connect and Configure Patient Monitoring Device

## Overview

This guide explains how to setup a Patient Monitoring Device that publishes simulated vital-sign telemetry to the Monitoring Hub (Promox Host) through MQTT.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Network Connection Options](#network-connection-options)
  - [Wired Connection via Proxmox Host](#wired-connection-via-proxmox-host)
  - [Wireless Connection via OpenWRT AP](#wireless-connection-via-openwrt-ap)
- [Set Up MQTT Publisher](#set-up-mqtt-publisher)
- [Run Multi-Channel Publisher](#run-multi-channel-publisher)
- [Verify Data Reception](#verify-data-reception)
- [Next Step](#next-step)

## Prerequisites

1. Ubuntu 24.04 LTS system for the patient monitoring device.
2. Install ssh `sudo apt install ssh` access to the patient monitoring device.
3. Monitoring Hub already set up and reachable.

## Network Connection Options

### Wired Connection via Proxmox Host

If the patient monitoring device is connected by Ethernet to the Proxmox host:

1. Log in to the Proxmox host.

2. Identify the physical port the patient device is plugged into.

   Ethernet ports report `NO-CARRIER` only after the kernel has brought
   them administratively up. List the candidate ports and bring each one
   up so its carrier state becomes observable:

    ```bash
    ip -br link                                  # list interfaces
    ```
   The port whose state changed from `NO-CARRIER` to `UP` (with
   `LOWER_UP` in the flags) is the one to use.

3. Edit `/etc/network/interfaces` and set the identified port as the
   `bridge-ports` of `vmbr1`. The stanza should look like:

    ```text
    auto vmbr1
    iface vmbr1 inet manual
            bridge-ports <port>
            bridge-stp off
            bridge-fd 0
    ```

   Replace `<port>` with the interface name from step 2 (e.g. `enp3s0`).

4. Reload only the affected interfaces and bring the port up. Do **not** run
   `ifreload -a` if the Proxmox host's uplink is wireless — it re-applies the
   `wlp*` stanza and briefly tears down Wi-Fi (and your SSH session).

    ```bash
    ifup <port>
    ifup vmbr1
    ip link set <port> up
    ```

5. Verify the port is attached to `vmbr1` and in state `UP`:

    ```bash
    ip -br link show <port>
    ip -br link show vmbr1
    bridge link show
    ```

6. To find the IP address assigned to the patient device, enter the
   OpenWRT VM and read the DHCP lease file:

    ```bash
    qm terminal 201
    cat /tmp/dhcp.leases
    ```

### Wireless Connection via OpenWRT AP

If the patient monitoring device is connected over Wi-Fi, join the SSID configured in [Setup OpenWRT VM on Proxmox Host](./openwrt_setup.md).

## Set Up MQTT Publisher

Connect monitor display to your patient monitoring device and launch terminal.
Run these on the patient monitoring device:

1. Clone repository:

    ```bash
    git clone https://github.com/open-edge-platform/edge-developer-kit-reference-scripts
    ```

2. Change directory:

    ```bash
    cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/patient_device
    ```

3. Run setup script:

    ```bash
    bash mqtt_setup.sh
    ```

This installs Docker, Python dependencies, time-sync packages, and creates virtual environment `mqtt_venv`.

## Run Multi-Channel Publisher

`multi_channels_test.py` simulates multiple patient monitoring devices publishing telemetry to the Monitoring Hub MQTT broker.

Activate the virtual environment:

```bash
cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/patient_device
source mqtt_venv/bin/activate
```

Basic run command:

```bash
python3 multi_channels_test.py --broker <MQTT_BROKER_IP>
```

- `<MQTT_BROKER_IP>` is the Monitoring Hub IP address (Ubuntu LXC from [Setup Monitoring Hub](./monitoring_hub_setup.md)).
- Default value for `--channels` is `5`.

Sample command:

```bash
python3 multi_channels_test.py --broker 10.0.0.101 --channels 5 --duration 60
```

Show all options:

```bash
python3 multi_channels_test.py --help
```

Press `Ctrl+C` to stop gracefully.

## Verify Data Reception

To confirm the Monitoring Hub receives and processes messages:

1. Log in to the Proxmox host.
2. Enter Monitoring Hub container `102`:

    ```bash
    pct enter 102
    ```

3. Check bridge logs:

    ```bash
    docker logs mqtt-influx-bridge --tail 50
    ```

Expected result:

- Log contains entries similar to:

  ```text
  [LATENCY] ward=ward2 patient=patient1 latency_ms=2.30
  [LATENCY] ward=ward2 patient=patient2 latency_ms=2.81
  ```

- This confirms patient-device telemetry is reaching the Monitoring Hub pipeline.

## Next Step

[Setup Nurses Station Dashboard](./nurse_dashboard.md)
