#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# MQTT multichannel test script for simulating multiple patient devices sending telemetry data to the patient monitoring hub.
#
# Design overview:
# - One worker thread represents one simulated device/channel.
# - Each worker publishes to a deterministic topic: wardX/patientY.
# - Publish rate is controlled per thread by sleeping `interval = 1 / rate`.
# - A small backpressure guard avoids unbounded growth of the MQTT outbound queue.
# - SIGINT/SIGTERM triggers coordinated shutdown via a shared event.

import argparse
import json
import random
import signal
import string
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

TOTAL_WARDS = 2
PATIENTS_PER_WARD = 5

# Global stop signal shared by all worker threads.
stop_event = threading.Event()


# ---------------- helpers ----------------
# Generate ISO 8601 UTC timestamp
def iso_utc_now():
    """Return current UTC time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()

# Generate random client ID suffix
def rand_id(k=6):
    """Build a random lowercase alphanumeric suffix for MQTT client IDs."""
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=k))  # nosec B311 - non-security MQTT client ID suffix

# Generate random telemetry payload with a unique message ID
def make_payload(msg_id: str):
    """Create a single synthetic telemetry message for testing."""
    return {
        "heart_rate": random.randint(60, 100),  # nosec B311 - simulated test data, not security-sensitive
        "spo2": random.randint(94, 100),  # nosec B311
        "respiratory_rate": random.randint(12, 22),  # nosec B311
        "body_temperature": round(random.uniform(36.3, 37.8), 1),  # nosec B311
        "blood_pressure": random.randint(90, 180),  # nosec B311
        "msg_id": msg_id,
        "sent_at": iso_utc_now(),
    }


# ---------------- channel worker ----------------
# Each channel simulates a patient device publishing telemetry data to a specific topic (ward/patient).
def channel_worker(idx, broker, port, qos, rate, keepalive):
    """Publish telemetry continuously for one simulated device until stop_event is set."""

    # Each thread gets a unique MQTT client ID to avoid collisions at the broker.
    client_id = f"iot_{idx}-{rand_id()}"

    # Map linear channel index -> topic hierarchy.
    # Example with 2 wards x 5 patients:
    # idx 0..4  -> ward1/patient1..5
    # idx 5..9  -> ward2/patient1..5
    # idx 10..14 repeats ward1/patient1..5, etc.
    ward_idx = (idx // PATIENTS_PER_WARD) % TOTAL_WARDS
    patient_idx = idx % PATIENTS_PER_WARD

    ward = f"ward{ward_idx + 1}"
    patient = f"patient{patient_idx + 1}"
    topic = f"{ward}/{patient}"

    client = mqtt.Client(
        client_id=client_id,
        protocol=mqtt.MQTTv311,
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    # Cap in-flight to 1 so the broker confirms each publish (PUBACK for QoS 1,
    # PUBCOMP for QoS 2) before the next one is shipped. This gives in-order
    # delivery per publisher on the wire at the cost of throughput.
    # Trade-off is acceptable for low-rate vitals telemetry (~1 Hz per channel).
    client.max_inflight_messages_set(1)
    client.max_queued_messages_set(1000)

    # This event allows the worker to wait for connection feedback from callback thread.
    connected = threading.Event()
    # MQTT v5 on_connect callback with reason code
    def on_connect(client, userdata, flags, reasonCode, properties=None):
        if reasonCode == 0:
            print(f"[CONNECTED] {client_id} → {topic}", flush=True)
            connected.set()
        else:
            print(f"[CONNECT FAIL] rc={reasonCode}", flush=True)

    client.on_connect = on_connect
    client.connect(broker, port, keepalive=keepalive)
    client.loop_start()

    # Wait for connect callback; if not connected, exit this worker.
    if not connected.wait(timeout=5):
        print(f"[CONNECT TIMEOUT] {client_id} -> {topic}", flush=True)
        client.loop_stop()
        return

    # Publish interval in seconds.
    # rate=2.0 => 0.5 sec between messages; invalid/non-positive rates fall back to 1 sec.
    interval = 1.0 / rate if rate > 0 else 1.0
    counter = 0

    try:
        while not stop_event.is_set():
            # If temporarily disconnected, wait for reconnect before publishing more.
            if not client.is_connected():
                time.sleep(0.2)
                continue

            msg_id = f"{client_id}-{counter}"
            payload = make_payload(msg_id)

            info = client.publish(
                topic,
                json.dumps(payload),
                qos=qos,
                retain=False
            )
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                # Lightweight backoff when publish cannot be queued/sent.
                time.sleep(0.05)
                continue

            # Keep per-client message IDs monotonic for easier trace/debug downstream.
            counter += 1
            time.sleep(interval)

    finally:
        # give some time for pending messages to be sent before disconnecting
        time.sleep(0.3)
        client.disconnect()
        client.loop_stop()


# ---------------- main ----------------

def parse_args():
    """Define and parse CLI options for broker endpoint and load profile."""
    ap = argparse.ArgumentParser(
        description="Simulate multiple patient devices publishing telemetry to an MQTT broker."
    )
    ap.add_argument(
        "--broker",
        required=True,
        help="MQTT broker hostname or IP address (for example: 192.168.1.10).",
    )
    ap.add_argument(
        "--port",
        type=int,
        default=1883,
        help="MQTT broker TCP port (default: 1883).",
    )
    ap.add_argument(
        "--channels",
        type=int,
        default=5,
        help="Number of concurrent simulated devices/channels to start (default: 5).",
    )
    ap.add_argument(
        "--rate",
        type=float,
        default=1.0,
        help="Publish rate per channel in messages per second (default: 1.0).",
    )
    ap.add_argument(
        "--qos",
        type=int,
        default=1,
        choices=[0, 1, 2],
        help="MQTT QoS level for publishes: 0, 1, or 2 (default: 1).",
    )
    ap.add_argument(
        "--keepalive",
        type=int,
        default=60,
        help="MQTT keepalive interval in seconds (default: 60).",
    )
    ap.add_argument(
        "--duration",
        type=int,
        default=30,
        help="Total test runtime in seconds before shutdown (default: 30).",
    )
    return ap.parse_args()


def main():
    """Start worker threads, run for the requested duration, then shut down cleanly."""
    args = parse_args()

    print(
        f"Starting publisher:\n"
        f"  broker={args.broker}:{args.port}\n"
        f"  channels={args.channels}\n"
        f"  rate={args.rate}/sec per channel\n"
        f"  qos={args.qos}\n"
        f"  duration={args.duration}s\n",
        flush=True
    )

    def stop(sig, frame):
        # Signal handlers only mark stop_event; workers handle their own disconnect logic.
        print("Stopping publishers…", flush=True)
        stop_event.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    threads = []
    for i in range(args.channels):
        # One daemon thread per channel/device simulation.
        t = threading.Thread(
            target=channel_worker,
            args=(i, args.broker, args.port, args.qos, args.rate, args.keepalive),
            daemon=True
        )
        t.start()
        threads.append(t)

    end = time.time() + args.duration
    while time.time() < end and not stop_event.is_set():
        time.sleep(0.2)

    # Ensure all workers exit even when duration expires without a signal.
    stop_event.set()
    for t in threads:
        # Bounded join keeps shutdown from hanging indefinitely.
        t.join(timeout=5)

    print("Done.", flush=True)


if __name__ == "__main__":
    main()