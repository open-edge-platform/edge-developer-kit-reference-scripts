#!/usr/bin/python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Build consolidated latency records from raw vitals + latency measurements.

This processor polls InfluxDB, joins two measurements, computes end-to-end
timings, and writes a compact "Latency" measurement used by the watcher.
"""

import time
from datetime import datetime, timezone
from influxdb_client import InfluxDBClient, Point, WritePrecision

# --------------------------------------------------
# Configuration
# --------------------------------------------------
SERVER_DB_URL    = "http://localhost:8086"
SERVER_DB_TOKEN  = "<YOUR_SERVER_DB_TOKEN>"
SERVER_DB_ORG    = "hospital"
SERVER_DB_BUCKET = "patient_data"

RANGE_WINDOW = "-1m"
INTERVAL_SEC  = 5

VITALS_FLUX = f"""
from(bucket: "{SERVER_DB_BUCKET}")
  |> range(start: {RANGE_WINDOW})
  |> filter(fn: (r) => r._measurement == "vitals")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: [
      "_time","ward","patient","msg_id",
      "heart_rate","spo2","respiratory_rate","body_temperature",
      "iot_sent_at","bridge_recv_at"
  ])
"""

LAT_FLUX = f"""
from(bucket: "{SERVER_DB_BUCKET}")
  |> range(start: {RANGE_WINDOW})
  |> filter(fn: (r) =>
      r._measurement == "vitals_latency" and
      (r._field == "broker_to_server" or r._field == "device_to_broker")
  )
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time","ward","patient","msg_id","broker_to_server","device_to_broker"])
"""


def parse_iso_utc(ts: str):
    """Parse RFC3339-ish timestamps into timezone-aware UTC datetimes."""
    if not ts:
        return None
    dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def main():
    """Continuously query, transform, and write aggregated latency points."""
    with InfluxDBClient(url=SERVER_DB_URL, token=SERVER_DB_TOKEN, org=SERVER_DB_ORG) as client:
        query_api = client.query_api()
        write_api = client.write_api()

        # Watermark used to avoid rewriting already-processed rows.
        # Note: this is time-based and assumes newer rows carry newer timestamps.
        last_seen_time = None

        while True:
            vitals_tables = query_api.query(VITALS_FLUX)
            lat_tables = query_api.query(LAT_FLUX)

            vitals_records = [r for t in vitals_tables for r in t.records]
            lat_records = [r for t in lat_tables for r in t.records]

            # Keep most recent latency row per ward/patient/msg_id.
            lat_by_key = {}
            for rec in lat_records:
                v = rec.values
                key = (str(v.get("ward", "")), str(v.get("patient", "")), str(v.get("msg_id", "")))
                ts = rec.get_time()
                prev = lat_by_key.get(key)
                if not prev or (ts and prev.get_time() and ts > prev.get_time()) or (ts and not prev.get_time()):
                    lat_by_key[key] = rec

            new_records = []
            points = []
            joined = 0

            for rec in vitals_records:
                v = rec.values
                key = (str(v.get("ward", "")), str(v.get("patient", "")), str(v.get("msg_id", "")))
                lrec = lat_by_key.get(key)
                if not lrec:
                    continue

                ts = rec.get_time()
                if last_seen_time and ts and ts <= last_seen_time:
                    continue

                lv = lrec.values
                try:
                    iot_dt = parse_iso_utc(v.get("iot_sent_at", ""))
                    bridge_dt = parse_iso_utc(v.get("bridge_recv_at", ""))
                except Exception:  # nosec B112 - intentionally skip malformed rows
                    continue

                if not iot_dt or not bridge_dt:
                    continue

                device_to_broker = (bridge_dt - iot_dt).total_seconds() * 1000.0
                broker_to_server = float(lv.get("broker_to_server", 0.0))
                device_to_server = device_to_broker + broker_to_server

                new_records.append(rec)
                joined += 1

                points.append(
                    Point("Latency")
                    .tag("ward", key[0])
                    .tag("patient", key[1])
                    .tag("msg_id", key[2])
                    .field("heart_rate", float(v["heart_rate"]))
                    .field("spo2", float(v["spo2"]))
                    .field("respiratory_rate", float(v["respiratory_rate"]))
                    .field("body_temperature", float(v["body_temperature"]))
                    .field("device_to_broker", device_to_broker)
                    .field("broker_to_server", broker_to_server)
                    .field("device_to_server", device_to_server)
                    .time(ts, WritePrecision.NS)
                )

            if points:
                write_api.write(SERVER_DB_BUCKET, SERVER_DB_ORG, points)
                last_seen_time = max(r.get_time() for r in new_records if r.get_time() is not None)
                print(
                    f"[latency_processor] vitals={len(vitals_records)} "
                    f"latency={len(lat_records)} joined={joined} wrote={len(points)}"
                )
            else:
                print(
                    f"[latency_processor] vitals={len(vitals_records)} "
                    f"latency={len(lat_records)} joined=0 wrote=0"
                )

            time.sleep(INTERVAL_SEC)

if __name__ == "__main__":
    main()