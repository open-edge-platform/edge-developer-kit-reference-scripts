# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Hardware telemetry service — proxies metrics from Intel metrics-manager.

The metrics-manager container (intel/metrics-manager) collects CPU, GPU, and NPU
metrics via Telegraf + qmassa + PMT sysfs. This service connects to its SSE
stream and exposes the data to our frontend in a normalized format.

Falls back to local psutil/sysfs readings if metrics-manager is unavailable.
"""

import logging
import os
# Only invoked below with hardcoded argv lists, never shell=True.
import subprocess  # nosec B404
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

METRICS_MANAGER_URL = os.environ.get("METRICS_MANAGER_URL", "http://metrics-manager:9090")

# Cached latest metrics from the SSE stream
_latest_metrics: Dict[str, Any] = {}
_metrics_lock = threading.Lock()
_stream_connected = False


_logged_raw_sample = False


def _parse_metrics_message(metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Parse metrics-manager SSE message into our telemetry schema."""
    global _logged_raw_sample
    if not _logged_raw_sample:
        npu_metrics = [m for m in metrics if "npu" in m.get("name", "")]
        power_freq_metrics = [m for m in metrics if any(
            k in m.get("name", "") for k in ("power", "frequency", "freq")
        )]
        if power_freq_metrics or npu_metrics:
            logger.info("Raw NPU metrics: %s", npu_metrics)
            logger.info("Raw power/freq metrics: %s", power_freq_metrics)
            _logged_raw_sample = True

    result = {
        "cpu": {"utilizationPercent": 0.0, "frequency": 0.0, "temperature": None,
                "usage": {}},
        "gpu": {"utilizationPercent": 0.0, "frequency": 0.0, "power": 0.0,
                "engines": {}},
        "npu": {"utilizationPercent": 0.0, "power": 0.0, "frequency": 0.0,
                "temperature": None, "memoryMB": 0.0, "bandwidth": 0},
        "memory": {"utilizationPercent": 0.0, "usedPercent": 0.0,
                   "availablePercent": 0.0, "usedBytes": 0, "totalBytes": 0},
    }

    for m in metrics:
        name = m.get("name", "")
        value = m.get("value", 0)
        labels = m.get("labels", {})

        # CPU metrics
        if name == "cpu_usage_user" and labels.get("cpu") == "cpu-total":
            result["cpu"]["utilizationPercent"] = round(value, 1)
            result["cpu"]["usage"]["user"] = round(value, 1)
        elif name == "cpu_usage_system" and labels.get("cpu") == "cpu-total":
            result["cpu"]["usage"]["system"] = round(value, 1)
        elif name == "cpu_usage_idle" and labels.get("cpu") == "cpu-total":
            result["cpu"]["usage"]["idle"] = round(value, 1)
        elif name == "cpu_frequency_avg_frequency":
            # value in kHz (e.g. 726010 → 0.73 GHz)
            result["cpu"]["frequency"] = round(value / 1_000_000, 2)
        elif name == "temp_temp" and "coretemp_package_id" in labels.get("sensor", ""):
            result["cpu"]["temperature"] = round(value, 1)

        # GPU metrics
        elif name == "gpu_engine_usage_usage":
            engine = labels.get("engine", "")
            result["gpu"]["engines"][engine] = round(value, 1)
            if engine in ("compute", "ccs", "render", "rcs"):
                result["gpu"]["utilizationPercent"] = max(
                    result["gpu"]["utilizationPercent"], round(value, 1)
                )
        elif name == "gpu_frequency" and labels.get("type") == "cur_freq":
            # value in MHz (e.g. 900 → 0.90 GHz)
            result["gpu"]["frequency"] = round(value / 1000, 2)
        elif name == "gpu_power" and labels.get("type") == "gpu_cur_power":
            # value in mW when > 100, else already watts
            watts = value / 1000 if value > 100 else value
            result["gpu"]["power"] = round(watts, 2)

        # NPU metrics
        elif name == "npu_utilization":
            result["npu"]["utilizationPercent"] = round(value, 1)
        elif name == "npu_power":
            watts = value / 1000 if value > 100 else value
            result["npu"]["power"] = round(watts, 2)
        elif name == "npu_frequency":
            # value in MHz (same as GPU)
            result["npu"]["frequency"] = round(value / 1000, 2)
        elif name == "npu_temperature":
            result["npu"]["temperature"] = round(value, 1)
        elif name == "npu_memory_mb":
            result["npu"]["memoryMB"] = round(value, 1)
        elif name == "npu_bandwidth":
            result["npu"]["bandwidth"] = round(value, 1)

        # Memory (system RAM — metrics-manager exposes no GPU VRAM counter)
        elif name == "mem_used_percent":
            result["memory"]["usedPercent"] = round(value, 1)
            result["memory"]["utilizationPercent"] = round(value, 1)
        elif name == "mem_available_percent":
            result["memory"]["availablePercent"] = round(value, 1)
        elif name == "mem_used":
            result["memory"]["usedBytes"] = int(value)
        elif name == "mem_total":
            result["memory"]["totalBytes"] = int(value)

    return result


def _stream_metrics():
    """Background thread that connects to metrics-manager SSE stream."""
    global _stream_connected
    import json

    while True:
        try:
            import urllib.request
            parsed = urlparse(METRICS_MANAGER_URL)
            allowed_schemes = ("http", "https")
            allowed_hosts = ("metrics-manager", "localhost", "127.0.0.1")
            scheme = next((s for s in allowed_schemes if s == parsed.scheme), "http")
            host = next((h for h in allowed_hosts if h == parsed.hostname), "metrics-manager")
            allowed_ports = (9090,)
            port = next((p for p in allowed_ports if p == parsed.port), 9090)
            url = f"{scheme}://{host}:{port}/metrics/stream"
            req = urllib.request.Request(url)
            req.add_header("Accept", "text/event-stream")

            with urllib.request.urlopen(req, timeout=10) as resp:  # nosec B310
                _stream_connected = True
                logger.info("Connected to metrics-manager SSE at %s", url)

                for line in resp:
                    line = line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    json_str = line[5:].strip()
                    if not json_str:
                        continue
                    try:
                        msg = json.loads(json_str)
                        if "metrics" in msg and isinstance(msg["metrics"], list):
                            parsed = _parse_metrics_message(msg["metrics"])
                            parsed["timestamp"] = datetime.now(timezone.utc).isoformat()
                            with _metrics_lock:
                                global _latest_metrics
                                _latest_metrics = parsed
                    except (json.JSONDecodeError, KeyError):
                        pass

        except Exception as e:
            _stream_connected = False
            logger.debug("Metrics-manager stream error: %s, retrying in 5s", e)
            time.sleep(5)


def _start_stream_thread():
    """Start the background SSE consumer thread."""
    t = threading.Thread(target=_stream_metrics, daemon=True, name="metrics-stream")
    t.start()
    logger.info("Metrics stream thread started (target: %s)", METRICS_MANAGER_URL)


# Start on import
_start_stream_thread()


def _with_activity(metrics: Dict[str, Any]) -> Dict[str, Any]:
    """Attach the per-device inference activity labels to a telemetry payload.

    Copies the top level so the cached `_latest_metrics` dict is never mutated
    by concurrent readers.
    """
    from src.backend.services.activity_service import get_device_activity

    activity = get_device_activity()
    result = dict(metrics)
    for key, device in (("cpu", "CPU"), ("gpu", "GPU"), ("npu", "NPU")):
        section = dict(result.get(key) or {})
        section["activity"] = activity.get(device, [])
        result[key] = section
    return result


def get_current_telemetry() -> Dict[str, Any]:
    """Return current telemetry — from metrics-manager if available, else local fallback."""
    with _metrics_lock:
        if _latest_metrics:
            return _with_activity(_latest_metrics)

    # Fallback to local readings if metrics-manager is not connected
    return _with_activity(_get_local_telemetry())


def get_telemetry_detailed() -> Dict[str, Any]:
    """Return detailed telemetry including power, frequency, and per-engine GPU usage."""
    with _metrics_lock:
        if _latest_metrics:
            return _with_activity(_latest_metrics)
    return _with_activity(_get_local_telemetry())


def is_metrics_manager_connected() -> bool:
    """Check if we're receiving metrics from the metrics-manager container."""
    return _stream_connected


def _get_local_telemetry() -> Dict[str, Any]:
    """Fallback: read metrics locally via psutil and sysfs."""
    cpu_pct = _get_cpu_utilization()
    gpu_pct = _get_gpu_utilization()
    npu_pct = _get_npu_utilization()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu": {"utilizationPercent": cpu_pct},
        "gpu": {"utilizationPercent": gpu_pct},
        "npu": {"utilizationPercent": npu_pct},
        "memory": _get_memory_stats(),
    }


def _get_memory_stats() -> Dict[str, Any]:
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "utilizationPercent": round(vm.percent, 1),
            "usedPercent": round(vm.percent, 1),
            "availablePercent": round(vm.available / vm.total * 100, 1) if vm.total else 0.0,
            "usedBytes": int(vm.used),
            "totalBytes": int(vm.total),
        }
    except (ImportError, Exception):
        return {"utilizationPercent": 0.0, "usedPercent": 0.0,
                "availablePercent": 0.0, "usedBytes": 0, "totalBytes": 0}


def _get_cpu_utilization() -> float:
    try:
        import psutil
        return psutil.cpu_percent(interval=None)
    except (ImportError, Exception):
        return 0.0


def _get_gpu_utilization() -> float:
    try:
        result = subprocess.run(
            ["xpu-smi", "dump", "-d", "0", "-m", "0", "-n", "1"],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0 and result.stdout:
            for line in result.stdout.strip().splitlines():
                if line.startswith("Timestamp"):
                    continue
                parts = line.split(",")
                if len(parts) >= 3:
                    val = parts[2].strip()
                    if val != "N/A":
                        return float(val)
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        pass

    gt0_base = Path("/sys/class/drm/card0/device/tile0/gt0")
    try:
        act_freq = int((gt0_base / "freq0" / "act_freq").read_text().strip())
        max_freq = int((gt0_base / "freq0" / "max_freq").read_text().strip())
        if max_freq > 0:
            return round(act_freq / max_freq * 100, 1)
    except (FileNotFoundError, ValueError, PermissionError):
        pass

    return 0.0


_npu_prev_busy_us: float = 0.0
_npu_prev_time: float = 0.0


def _get_npu_utilization() -> float:
    global _npu_prev_busy_us, _npu_prev_time

    busy_path = Path("/sys/class/accel/accel0/device/npu_busy_time_us")
    if not busy_path.exists():
        return 0.0

    try:
        busy_us = int(busy_path.read_text().strip())
        now = time.time()

        if _npu_prev_time == 0.0:
            _npu_prev_busy_us = busy_us
            _npu_prev_time = now
            return 0.0

        delta_busy = busy_us - _npu_prev_busy_us
        delta_wall = (now - _npu_prev_time) * 1_000_000  # seconds to microseconds

        _npu_prev_busy_us = busy_us
        _npu_prev_time = now

        if delta_wall <= 0:
            return 0.0

        return round(min(delta_busy / delta_wall * 100, 100.0), 1)
    except (ValueError, PermissionError, OSError):
        return 0.0
