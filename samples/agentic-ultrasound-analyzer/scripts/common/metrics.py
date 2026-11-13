# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Lightweight metrics collector for benchmarking the Agentic Ultrasound Analyzer POC.

Respects admin config: when benchmarking is "off", recording is a no-op.

Usage:
    from common.metrics import metrics, timed

    # As a decorator
    @timed("ovms_inference")
    def call_ovms(payload): ...

    # As a context manager
    with metrics.timer("blip_embed_image"):
        embedding = embedder.embed_image(path)

    # Manual recording
    metrics.record("startup_time", 12.34)

    # Get all metrics
    metrics.summary()  # -> dict with min/max/avg/p95/count per metric
"""

import time
import threading
import json
import os
import functools
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager
import subprocess #nosec
from common.config import config, BENCHMARK_MODE
from common.safe_paths import safe_component

class MetricsCollector:
    """Thread-safe metrics collector with timing helpers."""

    def __init__(self):
        self._lock = threading.Lock()
        self._timings: dict[str, list[float]] = defaultdict(list)
        self._timestamps: dict[str, dict] = {}  # last start/end per timer
        self._counters: dict[str, int] = defaultdict(int)
        self._gauges: dict[str, float] = {}
        self._start_time = time.monotonic()

    @property
    def enabled(self) -> bool:
        return config.benchmarking_enabled

    # ── Recording ─────────────────────────────────────────────
    def record(self, name: str, value_ms: float):
        """Record a timing value in milliseconds."""
        if not self.enabled:
            return
        with self._lock:
            self._timings[name].append(value_ms)

    def increment(self, name: str, amount: int = 1):
        """Increment a counter."""
        if not self.enabled:
            return
        with self._lock:
            self._counters[name] += amount

    def gauge(self, name: str, value: float):
        """Set a gauge (latest-value metric)."""
        if not self.enabled:
            return
        with self._lock:
            self._gauges[name] = value

    # ── Timer context manager ─────────────────────────────────
    @contextmanager
    def timer(self, name: str):
        """Context manager that records elapsed time in ms and wall-clock timestamps."""
        if not self.enabled:
            yield
            return
        start_wall = datetime.now().isoformat(timespec="milliseconds")
        t0 = time.perf_counter()
        yield
        elapsed_ms = (time.perf_counter() - t0) * 1000
        end_wall = datetime.now().isoformat(timespec="milliseconds")
        with self._lock:
            self._timings[name].append(elapsed_ms)
            self._timestamps[name] = {"start": start_wall, "end": end_wall, "elapsed_ms": round(elapsed_ms, 2)}

    def last_timer_ms(self, name: str) -> float:
        """Return the last elapsed_ms for a named timer, or 0 if not recorded."""
        if not self.enabled:
            return 0.0
        with self._lock:
            ts = self._timestamps.get(name)
            return ts["elapsed_ms"] if ts else 0.0

    # ── Summary ───────────────────────────────────────────────
    def summary(self) -> dict:
        """Return a summary of all collected metrics."""
        with self._lock:
            result = {
                "uptime_seconds": round(time.monotonic() - self._start_time, 1),
                "timings": {},
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
            }
            for name, values in self._timings.items():
                if not values:
                    continue
                sorted_vals = sorted(values)
                n = len(sorted_vals)
                p95_idx = min(int(n * 0.95), n - 1)
                entry = {
                    "count": n,
                    "min_ms": round(sorted_vals[0], 2),
                    "max_ms": round(sorted_vals[-1], 2),
                    "avg_ms": round(sum(sorted_vals) / n, 2),
                    "p95_ms": round(sorted_vals[p95_idx], 2),
                    "last_ms": round(values[-1], 2),
                }
                # Include wall-clock start/end from last invocation
                if name in self._timestamps:
                    entry["last_start"] = self._timestamps[name]["start"]
                    entry["last_end"] = self._timestamps[name]["end"]
                result["timings"][name] = entry
            return result

    def reset(self):
        """Clear all metrics (useful between benchmark runs)."""
        with self._lock:
            self._timings.clear()
            self._timestamps.clear()
            self._counters.clear()
            self._gauges.clear()
            self._start_time = time.monotonic()

    # ── Persistence ───────────────────────────────────────────
    def save_snapshot(self, directory: str = "reports", label: str = ""):
        """Save current metrics to a timestamped JSON file.

        When BENCHMARK_MODE is active, also writes to bench/output/.
        """
        os.makedirs(directory, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        label = safe_component(label, "") if label else ""
        tag = f"_{label}" if label else ""
        filename = f"metrics_{timestamp}{tag}.json"
        filepath = os.path.join(directory, filename)
        data = self.summary()
        data["snapshot_label"] = label
        data["snapshot_timestamp"] = datetime.now().isoformat()
        data["benchmark_mode"] = BENCHMARK_MODE
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        # Also write to bench/output/ when in benchmark mode
        from common.config import BENCHMARK_MODE, BENCHMARK_OUTPUT_DIR, BENCHMARK_RUN_ID
        if BENCHMARK_MODE:
            bench_dir = os.path.join(BENCHMARK_OUTPUT_DIR, "L1_workflow")
            os.makedirs(bench_dir, exist_ok=True)
            bench_path = os.path.join(bench_dir, filename)
            data["run_id"] = BENCHMARK_RUN_ID
            with open(bench_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            # Append to manifest
            _append_manifest(BENCHMARK_OUTPUT_DIR, BENCHMARK_RUN_ID, label)

        return filepath

    @staticmethod
    def compare(before_path: str, after_path: str) -> dict:
        """Compare two metric snapshots and return deltas."""
        with open(before_path, "r") as f:
            before = json.load(f)
        with open(after_path, "r") as f:
            after = json.load(f)

        comparison = {
            "before_label": before.get("snapshot_label", ""),
            "after_label": after.get("snapshot_label", ""),
            "timing_deltas": {},
        }
        before_timings = before.get("timings", {})
        after_timings = after.get("timings", {})

        all_keys = set(before_timings) | set(after_timings)
        for key in sorted(all_keys):
            b = before_timings.get(key, {})
            a = after_timings.get(key, {})
            b_avg = b.get("avg_ms", 0)
            a_avg = a.get("avg_ms", 0)
            if b_avg > 0:
                speedup = b_avg / a_avg if a_avg > 0 else float("inf")
                delta_ms = a_avg - b_avg
                delta_pct = ((a_avg - b_avg) / b_avg) * 100
            else:
                speedup = 0
                delta_ms = a_avg
                delta_pct = 0

            comparison["timing_deltas"][key] = {
                "before_avg_ms": round(b_avg, 2),
                "after_avg_ms": round(a_avg, 2),
                "delta_ms": round(delta_ms, 2),
                "delta_pct": round(delta_pct, 1),
                "speedup": round(speedup, 2),
            }
        return comparison


# ── Singleton instance ────────────────────────────────────────
metrics = MetricsCollector()


# ── Decorator ─────────────────────────────────────────────────
def timed(metric_name: str):
    """Decorator that records function execution time."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with metrics.timer(metric_name):
                return func(*args, **kwargs)
        return wrapper
    return decorator


# ── Manifest helper ───────────────────────────────────────────
def _append_manifest(output_dir: str, run_id: str, label: str):
    """Append a run entry to bench/output/manifest.jsonl (top-level)."""    
    manifest_dir = Path(output_dir).parent  # bench/output/ (above the run_id dir)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / "manifest.jsonl"
    git_sha = ""
    try:
        git_sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        pass
    entry = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "git_sha": git_sha,
        "label": label,
    }
    with open(manifest_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
