#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Central watcher for patient vitals with measured latency

- Reads pre-computed latency from InfluxDB
- Assumes a latency processor already joined vitals + latency
- Displays table + rolling latency summary
- READ ONLY
- No correction, no interpretation, no adjustment
"""

import time
from datetime import timezone, datetime
from statistics import mean
from collections import deque
from influxdb_client import InfluxDBClient
import os


# --------------------------------------------------
# Log
# --------------------------------------------------
LOG_DIR = "./latency_logs"
os.makedirs(LOG_DIR, exist_ok=True)

# --------------------------------------------------
# Configuration
# --------------------------------------------------
SERVER_DB_URL    = "http://localhost:8086"
SERVER_DB_TOKEN  = "<YOUR_SERVER_DB_TOKEN>"
SERVER_DB_ORG    = "hospital"
SERVER_DB_BUCKET = "patient_data"

MEASUREMENT = "Latency"

RANGE_WINDOW = "-1m"
REFRESH_SEC  = 1

MAX_ROWS     = 30
MAX_SAMPLES  = 5000

# --------------------------------------------------
# Rolling buffers (simple statistics only)
# --------------------------------------------------
buf_d2b = deque(maxlen=MAX_SAMPLES)
buf_b2c = deque(maxlen=MAX_SAMPLES)
buf_d2c = deque(maxlen=MAX_SAMPLES)
seen_keys = set()


def pick_numeric(v, keys):
    """Return first numeric value from candidate keys, else None."""
    for k in keys:
        if k not in v:
            continue
        try:
            x = float(v[k])
            if x >= 0:
                return x
        except (TypeError, ValueError):
            continue
    return None

def record_key(rec):
    """Create a stable deduplication key for one latency record."""
    v = rec.values
    t = rec.get_time()
    return (
        t.isoformat() if t else "",
        str(v.get("ward", "")),
        str(v.get("patient", "")),
        str(v.get("msg_id", "")),
    )

# --------------------------------------------------
# Flux query (SIMPLE & STABLE)
# --------------------------------------------------
FLUX = f"""
from(bucket: "{SERVER_DB_BUCKET}")
  |> range(start: {RANGE_WINDOW})
  |> filter(fn: (r) => r._measurement == "{MEASUREMENT}")
  |> pivot(
      rowKey: ["_time"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
"""

# --------------------------------------------------
# Table formatting
# --------------------------------------------------
HEADERS = [
    "central_time(UTC)",
    "ward", "patient",
    "HR", "SpO2", "RR", "Temp"
]

WIDTHS = [24, 6, 8, 4, 4, 4, 4]

def fmt_time(dt):
    """Format a datetime as UTC ISO-8601 text for stable table display."""
    return dt.astimezone(timezone.utc).isoformat() if dt else ""

def fmt_row(rec):
    """Extract and normalize selected columns from an Influx record for rendering."""
    v = rec.values
    return [
        fmt_time(rec.get_time()),
        v.get("ward",""),
        v.get("patient",""),
        v.get("heart_rate",""),
        v.get("spo2",""),
        v.get("respiratory_rate",""),
        v.get("body_temperature",""),
    ]

# -------------------------------------------------
# Render Table 
# -------------------------------------------------
def render_table(records):
    """
    Build an ASCII table from query records.

    The table is sorted by record time descending, then clipped to MAX_ROWS
    so each refresh stays readable in a terminal.
    """
    lines = []
    header = " | ".join(h.ljust(w) for h, w in zip(HEADERS, WIDTHS))
    sep    = "-+-".join("-" * w for w in WIDTHS)

    lines.append(header)
    lines.append(sep)

    records = sorted(records, key=lambda r: r.get_time(), reverse=True)[:MAX_ROWS]

    for rec in records:
        row = fmt_row(rec)
        lines.append(" | ".join(str(v).ljust(w)[:w] for v, w in zip(row, WIDTHS)))

    return "\n".join(lines)

# --------------------------------------------------
# Snapshot last data
# --------------------------------------------------
def dump_snapshot(table_text, summaries_text):
    """
    Persist the latest table + summary snapshot to a timestamped log file.

    This is used when the stream goes empty, so the most recent observed
    values are still available for post-run inspection.
    """
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    fname = os.path.join(LOG_DIR, f"{ts}.log")

    with open(fname, "w") as f:
        f.write(f"Latency snapshot @ {ts}\n")
        f.write("=" * 40 + "\n\n")
        f.write(table_text)
        f.write("\n\n")
        f.write("=" * 40 + "\n")
        f.write("Latency Summary\n")
        f.write("=" * 40 + "\n")
        f.write(summaries_text)

    print(f"\n📁 Snapshot written to {fname}\n", flush=True)

# --------------------------------------------------
# Summary
# --------------------------------------------------
def summarize(label, data):
    """
    Compute simple latency summary stats for a rolling buffer.

    Input values are expected in milliseconds. Output is formatted in seconds
    for readability.
    """
    if not data:
        return f"{label}: no data"

    arr = sorted(data)
    n = len(arr)

    return (
        f"{label}:\n"
        f" Average      : {(mean(arr)/1000):.3f} s\n"
        f" Typical (p50): {(arr[int(n*0.5)]/1000):.3f} s\n"
        f" 95% of msgs ≤ : {(arr[int(n*0.95)]/1000):.3f} s\n"
        f" 99% of msgs ≤ : {(arr[int(n*0.99)]/1000):.3f} s"
    )

# --------------------------------------------------
# Main
# --------------------------------------------------
def main():
    """
    Poll InfluxDB on a fixed interval and render current latency view.

    Loop behavior:
    1) Query records from the configured time window.
    2) Render a table of recent rows.
    3) Update rolling latency buffers and print percentile summaries.
    4) If no data appears, dump one snapshot and reset buffers.
    """
    with InfluxDBClient(
        url=SERVER_DB_URL,
        token=SERVER_DB_TOKEN,
        org=SERVER_DB_ORG
    ) as client:

        q = client.query_api()
        last_table_text = ""

        while True:
            tables = q.query(FLUX)
            records = [r for t in tables for r in t.records]

            # Clear terminal for an in-place dashboard effect.
            print("\033[2J\033[H", end="")
            print(f"Server latency monitoring — bucket={SERVER_DB_BUCKET}\n")

            # Table
            if records:
                table_text = render_table(records)
                last_table_text = table_text
                print(table_text)

                # Rolling summary buffers for latency fields collected by pipeline.
                # Deduplicate records across refresh cycles to avoid recounting
                # the same points returned by the overlapping query window.
                for rec in records:
                    key = record_key(rec)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    v = rec.values
                    d2b = pick_numeric(v, ["device_to_broker", "device_to_bridge", "device_to_bridge_ms"])
                    b2c = pick_numeric(v, ["broker_to_server", "hub_to_server", "bridge_to_server"])
                    d2c = pick_numeric(v, ["device_to_server", "device_to_central", "end_to_end"])

                    if d2b is not None:
                        buf_d2b.append(d2b)
                    if b2c is not None:
                        buf_b2c.append(b2c)
                    if d2c is not None:
                        buf_d2c.append(d2c)

                print("\n==================")
                print("Latency Summary")
                print("==================")
                print(summarize("Patient Device → Hub", buf_d2b))
                print()
                print(summarize("Hub → Server", buf_b2c))
                print()
                print(summarize("Patient Device → Server", buf_d2c))

            #time.sleep(REFRESH_SEC)
            else:
                if buf_d2b or buf_b2c or buf_d2c:
                    dump_snapshot(
                        table_text=last_table_text,
                        summaries_text = (
                            summarize("Patient Device -> Hub", buf_d2b) + "\n\n" +
                            summarize("Hub → Server", buf_b2c) + "\n\n" +
                            summarize("Patient Device → Server", buf_d2c)
                        )
                    )
                
                # Reset buffers
                buf_d2b.clear()
                buf_b2c.clear()
                buf_d2c.clear()
                seen_keys.clear()
                print("No data in time window.")

            time.sleep(REFRESH_SEC)

if __name__ == "__main__":
    main()