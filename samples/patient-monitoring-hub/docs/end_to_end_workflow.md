# End-to-End Workflow

## Overview

Follow this guide after you have completed the setup for the Central Monitoring System Server, Monitoring Hub, Patient Monitoring Device, and Nurses Station Dashboard.

This workflow starts the runtime components in the correct order so you can:

- View latency metrics in the terminal watcher
- View patient telemetry in the nurses station dashboard
- Generate test telemetry from the patient monitoring device

## Table of Contents

- [Prerequisites](#prerequisites)
- [Run Order](#run-order)
- [Step 0: One-Time Configuration](#step-0-one-time-configuration)
- [Step 1: Start the Latency Processor](#step-1-start-the-latency-processor)
- [Step 2: Start the Latency Watcher](#step-2-start-the-latency-watcher)
- [Step 3: Start the Nurse Station Dashboard](#step-3-start-the-nurse-station-dashboard)
- [Step 4: Start the Multi-Channel Publisher](#step-4-start-the-multi-channel-publisher)
- [Expected Result](#expected-result)
- [Quick Verification](#quick-verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, complete the setup steps in these guides:

1) [Setup Proxmox Host](./proxmox_setup.md)
2) [Setup OpenWRT VM](./openwrt_setup.md)
3) [Setup Central Monitoring System Server](./server_setup.md)
4) [Setup Monitoring Hub (Ubuntu LXC)](./monitoring_hub_setup.md)
5) [Connect and configure Patient Monitoring Device](./patient_device.md)
6) [Setup Nurse Station Dashboard](./nurse_dashboard.md)

For detailed benchmark behavior and tuning guidance, see [Benchmark latency setup](./benchmark.md).

## Run Order

Start the components in this order:

0. one-time configuration (server URL and tokens)
1. `latency_processor.py`
2. `watcher.py`
3. nurse station dashboard
4. multi-channel publisher

Starting the benchmark tools and dashboard before the publisher helps ensure you can observe data as soon as messages begin to flow.

## Step 0: One-Time Configuration

Before starting runtime components, update connection settings once:

1. Benchmark scripts on server:
	- Update `SERVER_DB_TOKEN` in `latency_processor.py`.
	- Update `SERVER_DB_TOKEN` in `watcher.py`.
	- Detailed guide: [Benchmark latency setup](./benchmark.md).

2. Nurse dashboard on nurse station:
	- Update `INFLUX_URL` and `INFLUX_TOKEN` in `nurse_dashboard.py` with the server DB token.
	- Detailed guide: [Setup Nurse Station Dashboard](./nurse_dashboard.md).

## Step 1: Start the Latency Processor

On the server system:

```bash
cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/server/benchmark
source ../server_env/bin/activate
python3 latency_processor.py
```

This script joins vitals and latency fields, then writes consolidated `Latency` measurement. Keep this terminal running.

For deeper details about how `latency_processor.py` works, see [Benchmark latency setup](./benchmark.md).

## Step 2: Start the Latency Watcher

On the server system, open a second terminal:

```bash
cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/server/benchmark
source ../server_env/bin/activate
python3 watcher.py
```

This script reads `Latency` measurement and shows rolling latency summary. Keep this terminal running. The watcher will refresh continuously and display the latest latency summary.

For deeper details about how `watcher.py` works, see [Benchmark latency setup](./benchmark.md).

## Step 3: Start the Nurse Station Dashboard

On the nurse station system:

```bash
cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/nurse_dashboard
source nurse_dashboard/bin/activate
streamlit run nurse_dashboard.py 
```

Then open the dashboard in a browser:

```text
http://<SYSTEM_IP>:8501
```

Keep this terminal running.

## Step 4: Start the Multi-Channel Publisher

On the patient device system:

```bash
cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/patient_device
source mqtt_venv/bin/activate
python3 multi_channels_test.py --broker <MQTT_BROKER_IP>
```

- Replace `<MQTT_BROKER_IP>` with the monitoring hub IP address.
- Add optional arguments such as `--channels`, `--rate`, and `--duration` as needed.

Example:

```bash
python3 multi_channels_test.py --broker 10.0.0.101 --channels 5 --duration 60
```

## Expected Result

After the publisher starts:

1. `watcher.py` should show latency rows and rolling summaries.
2. The nurse station dashboard should show incoming patient telemetry.
3. The monitoring hub bridge logs should show incoming MQTT messages.

## Quick Verification

If you want to confirm the full flow:

1. Check that `latency_processor.py` prints writes for latency points.
2. Check that `watcher.py` displays `Patient Device → Hub`, `Hub → Server`, and `Patient Device → Server` summaries.
3. Check that the dashboard displays live patient records.
4. Check monitoring hub logs for processing output:

```bash
pct enter 102
docker logs mqtt-influx-bridge --tail 50
```

You should see log lines similar to:

```text
[LATENCY] ward=ward2 patient=patient1 latency_ms=2.30
[LATENCY] ward=ward2 patient=patient2 latency_ms=2.81
```

## Troubleshooting

### No latency data in `watcher.py`

1. Confirm `latency_processor.py` is running.
2. Confirm the monitoring hub is writing `vitals` and `vitals_latency` data to the server InfluxDB instance.
3. Confirm `SERVER_DB_TOKEN` is updated correctly in both scripts as described in [Benchmark latency setup](./benchmark.md).

### No data in the dashboard

1. Confirm `nurse_dashboard.py` is configured with the correct `INFLUX_URL` and `INFLUX_TOKEN` as described in [Setup Nurse Station Dashboard](./nurse_dashboard.md).
2. Confirm patient telemetry is being written to the server database.
3. Confirm the publisher is sending to the correct MQTT broker IP.

### Publisher runs, but no messages arrive

1. Confirm the monitoring hub containers are running.
2. Confirm the patient device can reach the monitoring hub IP address.
3. Confirm the broker IP used in `multi_channels_test.py` is the monitoring hub IP address.
