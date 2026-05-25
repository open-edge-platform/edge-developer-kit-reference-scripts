# Benchmark latency

## Overview

This benchmark flow measures end-to-end telemetry latency in the Patient Monitoring Hub pipeline using two scripts:

- `latency_processor.py` computes normalized latency metrics and writes them into a dedicated InfluxDB measurement.
- `watcher.py` reads those computed metrics and displays a live terminal dashboard with rolling summaries.

Use this guide when you want to monitor how long telemetry takes to move from patient device to broker and from broker to server.

Use this as the detailed reference for Step 0, Step 1, and Step 2 in [End-to-End Workflow](./end_to_end_workflow.md).

## Table of Contents

- [Required One-Time Configuration](#required-one-time-configuration)
- [Get Started](#get-started)
- [How the Benchmark Components Work](#how-the-benchmark-components-work)

## Required One-Time Configuration

Before running benchmark scripts, update `SERVER_DB_TOKEN` in both files:

- `latency_processor.py`
- `watcher.py`

Use the `SERVER_TOKEN` value generated in [Setup Central Monitoring System Server](./server_setup.md), and keep it as a quoted string:

```python
SERVER_DB_TOKEN = "<YOUR_SERVER_DB_TOKEN>"
```

## Get Started

1. Go to directory:

    ```bash
    cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts/server/benchmark
    ```

2. Source environment:

    ```bash
    source ../server_env/bin/activate
    ```

3. Start the latency processor:

	```bash
	python3 latency_processor.py
	```

4. In another terminal, repeat step 1 and step 2, then start the watcher:

	```bash
	python3 watcher.py
	```

5. After you start `watcher.py`, the terminal should refresh continuously and show a table plus summary similar to the following:

    ```text
    Server latency monitoring — bucket=patient_data

    central_time(UTC)          | ward   | patient  | HR   | SpO2 | RR   | Temp
    --------------------------+--------+----------+------+------+------+-----
    2026-05-02T02:11:21+00:00 | ward1  | patient1 | 78   | 98   | 16   | 36.9
    2026-05-02T02:11:21+00:00 | ward1  | patient2 | 73   | 97   | 15   | 37.1
    2026-05-02T02:11:20+00:00 | ward1  | patient3 | 81   | 99   | 17   | 36.8
    2026-05-02T02:11:20+00:00 | ward1  | patient4 | 75   | 98   | 16   | 37.0
    2026-05-02T02:11:19+00:00 | ward1  | patient5 | 79   | 97   | 15   | 36.7

    ==================
    Latency Summary
    ==================
    Patient Device → Broker:
    Average      : 0.018 s
    Typical (p50): 0.016 s
    95% of msgs ≤ : 0.031 s
    99% of msgs ≤ : 0.039 s

    Broker → Server:
    Average      : 0.009 s
    Typical (p50): 0.008 s
    95% of msgs ≤ : 0.015 s
    99% of msgs ≤ : 0.018 s

    Patient Device → Server:
    Average      : 0.027 s
    Typical (p50): 0.025 s
    95% of msgs ≤ : 0.044 s
    99% of msgs ≤ : 0.052 s
    ```

    Notes:

    - Values will vary depending on load, host resources, and network conditions.
    - If no rows appear, confirm that `latency_processor.py` is running and writing `Latency` measurement points.

## How the Benchmark Components Work

### `latency_processor.py`

The processor runs as a polling job.

1. Queries recent records from the server InfluxDB bucket (`patient_data`).
2. Joins `vitals` data with `vitals_latency` using `ward`, `patient`, and `msg_id`.
3. Computes three latency fields:
	- `device_to_broker`
	- `broker_to_server`
	- `device_to_server`
4. Writes normalized output to measurement `Latency`.
5. Uses a time watermark (`last_seen_time`) to avoid rewriting older rows.

### `watcher.py`

The watcher runs as a read-only live monitor.

1. Polls measurement `Latency` every second.
2. Renders a table of latest vitals and related identifiers.
3. Builds rolling summaries for the three latency fields:
	- Patient Device -> Broker
	- Broker -> Server
	- Patient Device -> Server
4. Deduplicates records across refresh cycles to avoid counting the same message repeatedly.
5. If data stops, writes a snapshot log under `./latency_logs`.

For full runtime sequence with dashboard and publisher, see [End-to-End Workflow](./end_to_end_workflow.md).