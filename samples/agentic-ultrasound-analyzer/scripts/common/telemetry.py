# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Intel hardware telemetry for the Agentic Ultrasound Analyzer POC.

Provides on-demand device info and OVMS metrics scraping.
No background threads — only queries when called. Zero overhead on inference path.
"""

import re
import requests
from functools import lru_cache

_OVMS_METRICS_URL = "http://localhost:8000/metrics"


@lru_cache(maxsize=1)
def get_device_info() -> dict:
    """Query OpenVINO device properties (cached — hardware doesn't change at runtime)."""
    try:
        import openvino as ov
        core = ov.Core()
    except ImportError:
        return {"error": "openvino not installed"}

    devices = {}
    for dev in core.available_devices:
        info = {"name": dev}
        for prop in ["FULL_DEVICE_NAME", "DEVICE_ARCHITECTURE"]:
            try:
                info[prop.lower()] = str(core.get_property(dev, prop))
            except Exception:
                pass
        if "GPU" in dev:
            try:
                mem_bytes = core.get_property(dev, "GPU_DEVICE_TOTAL_MEM_SIZE")
                info["total_memory_gb"] = round(mem_bytes / (1024**3), 1)
            except Exception:
                pass
            try:
                info["uarch_version"] = str(core.get_property(dev, "GPU_UARCH_VERSION"))
            except Exception:
                pass
        if "NPU" in dev:
            try:
                info["npu_arch"] = str(core.get_property(dev, "DEVICE_ARCHITECTURE"))
            except Exception:
                pass
        devices[dev] = info
    return {"devices": devices, "available": core.available_devices}


def scrape_ovms_metrics() -> dict:
    """Fetch and parse Prometheus metrics from OVMS. Returns parsed dict or error."""
    try:
        resp = requests.get(_OVMS_METRICS_URL, timeout=2)
        if resp.status_code != 200:
            return {"error": f"OVMS metrics returned {resp.status_code}",
                    "hint": "Start OVMS with --metrics_enable flag"}
    except requests.ConnectionError:
        return {"error": "OVMS not reachable",
                "hint": "Start OVMS with --metrics_enable flag"}
    except requests.Timeout:
        return {"error": "OVMS metrics timeout"}

    return _parse_prometheus(resp.text)


def _parse_prometheus(text: str) -> dict:
    """Parse Prometheus text format into a structured dict."""
    metrics = {}
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        # Match: metric_name{labels} value  OR  metric_name value
        match = re.match(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?(.*?)\}?\s+([0-9eE.+\-]+)$', line)
        if match:
            name, labels_str, value = match.groups()
            try:
                val = float(value)
            except ValueError:
                val = value

            if name not in metrics:
                metrics[name] = []

            entry = {"value": val}
            if labels_str:
                labels = dict(re.findall(r'(\w+)="([^"]*)"', labels_str))
                entry["labels"] = labels
            metrics[name].append(entry)

    # Summarize key OVMS metrics
    summary = {
        "raw_metric_count": len(metrics),
        "inference": _extract_inference_metrics(metrics),
        "requests": _extract_request_metrics(metrics),
    }
    return summary


def _extract_inference_metrics(metrics: dict) -> dict:
    """Extract inference-specific metrics."""
    result = {}
    # OVMS inference duration
    for key in ["ovms_inference_time_us", "ovms_request_time_us"]:
        if key in metrics:
            for entry in metrics[key]:
                labels = entry.get("labels", {})
                model = labels.get("name", "unknown")
                if model not in result:
                    result[model] = {}
                result[model][key] = entry["value"]

    # Inference count
    for key in ["ovms_requests_success", "ovms_requests_fail"]:
        if key in metrics:
            for entry in metrics[key]:
                labels = entry.get("labels", {})
                model = labels.get("name", "unknown")
                if model not in result:
                    result[model] = {}
                result[model][key] = int(entry["value"])

    return result


def _extract_request_metrics(metrics: dict) -> dict:
    """Extract request-level metrics."""
    result = {}
    for key, entries in metrics.items():
        if "ovms" in key and entries:
            # Just take the last/total value for simple metrics
            if len(entries) == 1:
                result[key] = entries[0]["value"]
    return result
