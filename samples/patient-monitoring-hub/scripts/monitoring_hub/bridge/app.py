#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json
import time
import threading
import queue
from datetime import datetime, timezone

from paho.mqtt import client as mqtt
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import WriteOptions, SYNCHRONOUS

# --------------------------------------------------
# MQTT config
# --------------------------------------------------
MQTT_BROKER = "mqtt-broker"
MQTT_PORT = 1883
MQTT_TOPIC = "#"

HUB_INFLUX_URL = "http://influxdb:8086"
HUB_TOKEN = os.getenv("HUB_TOKEN")
HUB_ORG = "hospital"
HUB_BUCKET = "patient_data"

if not HUB_TOKEN:
    raise RuntimeError("HUB_TOKEN is not set. Provide it via an env file or environment variable.")


# Server DATABASE
SERVER_INFLUXDB_URL = os.getenv("SERVER_INFLUXDB_URL") # e.g. "http://<SERVER_IP>:8086"
SERVER_TOKEN = os.getenv("SERVER_TOKEN")
SERVER_ORG = "hospital"
SERVER_BUCKET = "patient_data"

if not SERVER_INFLUXDB_URL or not SERVER_TOKEN:
    raise RuntimeError("SERVER_INFLUXDB_URL and SERVER_TOKEN must be set for central server connection.")

hub_client = InfluxDBClient(
    url=HUB_INFLUX_URL,
    token=HUB_TOKEN,
    org=HUB_ORG
)

server_client = InfluxDBClient(
    url=SERVER_INFLUXDB_URL,
    token=SERVER_TOKEN,
    org=SERVER_ORG
)

MAX_LATENCY_MS = 2000        # Drop stale latency above this
MAX_QUEUE_SIZE = 3000        # Protect async write queue

write_options = WriteOptions(
    batch_size=500, #Controls how many points are collected before a write is triggered
    flush_interval=500, #Forces a write after a fixed time even if batch_size is not reached
    jitter_interval=200, #Add random delay to flush interval
    retry_interval=1000 #Wait time before retrying a failed write
)

hub_write    = hub_client.write_api(write_options=write_options)
server_write = server_client.write_api(write_options=write_options)
server_write_sync = server_client.write_api(write_options=SYNCHRONOUS)

# --------------------------------------------------
# Write queue & worker threads
# --------------------------------------------------
write_q = queue.Queue(maxsize=5000)

def db_worker():
    """Background worker for all InfluxDB writes."""
    while True:
        item = write_q.get()
        try:
            if len(item) == 2:
                point, target = item
                meta = None
            else:
                point, target, meta = item

            if target == "hub":
                hub_write.write(bucket=HUB_BUCKET, org=HUB_ORG, record=point)
            elif target == "server":
                server_write.write(bucket=SERVER_BUCKET, org=SERVER_ORG, record=point)
            elif target == "server_latency":
                # Practical pipeline latency:
                # broker receive time -> successful server write completion.
                if not isinstance(meta, dict):
                    print("[DB WORKER ERROR] Missing metadata for server_latency write")
                    continue

                required_keys = {"recv_time", "ward", "patient", "msg_id", "device_to_broker"}
                if not required_keys.issubset(meta.keys()):
                    print("[DB WORKER ERROR] Incomplete metadata for server_latency write")
                    continue

                server_write_sync.write(bucket=SERVER_BUCKET, org=SERVER_ORG, record=point)
                broker_to_server_ms = max(
                    0.0,
                    (datetime.now(timezone.utc) - meta["recv_time"]).total_seconds() * 1000.0,
                )

                lat_complete = (
                    Point("vitals_latency")
                    .tag("ward", meta["ward"])
                    .tag("patient", meta["patient"])
                    .tag("msg_id", meta["msg_id"])
                    .field("device_to_broker", meta["device_to_broker"])
                    .field("broker_to_server", broker_to_server_ms)
                    .time(meta["recv_time"], WritePrecision.NS)
                )
                server_write_sync.write(bucket=SERVER_BUCKET, org=SERVER_ORG, record=lat_complete)
            else:
                print(f"[DB WORKER ERROR] Unknown target '{target}'")
        except Exception as e:
            print(f"[DB WORKER ERROR] {e}")
        finally:
            write_q.task_done()

#  Start worker threads (2 is usually plenty)
for _ in range(2):
    threading.Thread(target=db_worker, daemon=True).start()

# --------------------------------------------------
# MQTT message handler
# --------------------------------------------------
def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())
    except Exception as e:
        print(f"[JSON ERROR] {e}")
        return

    try:
        ward, patient = msg.topic.split("/", 1)
    except ValueError:
        print(f"[TOPIC ERROR] {msg.topic}")
        return

    msg_id = str(data.get("msg_id", ""))
    sent_at_str = str(data.get("sent_at", ""))
    recv_time = datetime.now(timezone.utc)

    # --------------------------------------------------
    # Build vitals point
    # --------------------------------------------------
    try:
        vitals = (
            Point("vitals")
            .tag("ward", ward)
            .tag("patient", patient)
            .tag("msg_id", msg_id)
            .field("heart_rate", float(data["heart_rate"]))
            .field("spo2", float(data["spo2"]))
            .field("respiratory_rate", float(data["respiratory_rate"]))
            .field("body_temperature", float(data["body_temperature"]))
            .field("blood_pressure", float(data["blood_pressure"]))
            .field("iot_sent_at", sent_at_str)
            .field("bridge_recv_at", recv_time.isoformat())
            .time(recv_time, WritePrecision.NS)
        )
    except Exception as e:
        print(f"[VITALS BUILD ERROR] {e}")
        return

    #  enqueue vitals write
    write_q.put((vitals, "hub"))
    write_q.put((vitals, "server"))

    # --------------------------------------------------
    # Compute device → bridge latency
    # --------------------------------------------------
    latency_ms = None
    try:
        sent_at = datetime.fromisoformat(sent_at_str.replace("Z", "+00:00"))
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        latency_ms = (recv_time - sent_at).total_seconds() * 1000.0
    except Exception as e:
        print(f"[LATENCY PARSE ERROR] Could not parse sent_at='{sent_at_str}': {e}")

    if latency_ms is not None:
        print(
            f"[LATENCY] ward={ward} patient={patient} "
            f"latency_ms={latency_ms:.2f}",
            flush=True
        )

    if latency_ms is not None and latency_ms > MAX_LATENCY_MS:
        return

    # --------------------------------------------------
    # Build vitals_latency point
    # --------------------------------------------------
    if latency_ms is not None:
        lat = (
            Point("vitals_latency")
            .tag("ward", ward)
            .tag("patient", patient)
            .tag("msg_id", msg_id)
            .field("device_to_broker", latency_ms)
            .time(recv_time, WritePrecision.NS)
        )

        if write_q.qsize() > MAX_QUEUE_SIZE:
            #skip latency write
            return
        # enqueue latency writes
        write_q.put((lat, "hub"))
        write_q.put((
            lat,
            "server_latency",
            {
                "recv_time": recv_time,
                "ward": ward,
                "patient": patient,
                "msg_id": msg_id,
                "device_to_broker": latency_ms,
            },
        ))

# --------------------------------------------------
# MQTT client
# --------------------------------------------------
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_message = on_message
mqtt_client.connect(MQTT_BROKER, MQTT_PORT)
mqtt_client.subscribe(MQTT_TOPIC)

print(" MQTT → Influx bridge running")
mqtt_client.loop_forever()