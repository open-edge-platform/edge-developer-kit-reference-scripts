# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Runtime configuration store for the Agentic Ultrasound Analyzer POC.

Provides a thread-safe configuration singleton that can be updated
at runtime via the admin API.

Settings:
    benchmarking_mode: "off" | "standard" | "deep_stack_11"
    logging: "off" | "normal" | "verbose"
"""

import json
import os
import threading
from pathlib import Path

from common.safe_paths import resolve_within

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
_CONFIG_FILE = _SCRIPTS_DIR / "admin_config.json"


def _env_default_benchmark_mode() -> str:
    # Dedicated benchmark runs should default to deep mode.
    return "deep_stack_11" if os.environ.get("BENCHMARK_MODE") == "1" else "off"

_DEFAULTS = {
    "benchmarking_mode": _env_default_benchmark_mode(),
    "logging": "normal",
    "profiling": "off",
}

# Benchmark output directory (used by metrics when BENCHMARK_MODE is active);
# BENCHMARK_OUTPUT must stay inside the scripts directory.
BENCHMARK_MODE = os.environ.get("BENCHMARK_MODE") == "1"
BENCHMARK_RUN_ID = os.environ.get("BENCHMARK_RUN_ID", "")
BENCHMARK_OUTPUT_DIR = str(
    resolve_within(_SCRIPTS_DIR, os.environ.get("BENCHMARK_OUTPUT", "bench/output"))
    or _SCRIPTS_DIR / "bench" / "output"
)

_VALID = {
    "benchmarking_mode": ("off", "standard", "deep_stack_11"),
    # Backward-compatible write path for legacy admin clients.
    "benchmarking": ("on", "off"),
    "logging": ("off", "normal", "verbose"),
    "profiling": ("off", "on"),
}


class AppConfig:
    """Thread-safe runtime configuration."""

    def __init__(self):
        self._lock = threading.Lock()
        self._data = dict(_DEFAULTS)
        self._load()

    def _load(self):
        """Load persisted config from disk if it exists."""
        if _CONFIG_FILE.exists():
            try:
                with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                mode = saved.get("benchmarking_mode")
                if mode in _VALID["benchmarking_mode"]:
                    self._data["benchmarking_mode"] = mode
                elif saved.get("benchmarking") in _VALID["benchmarking"]:
                    # Migrate legacy on/off to the new mode key.
                    self._data["benchmarking_mode"] = (
                        "standard" if saved.get("benchmarking") == "on" else "off"
                    )
                for key in ("logging", "profiling"):
                    if key in saved and saved[key] in _VALID.get(key, ()):
                        self._data[key] = saved[key]
            except (json.JSONDecodeError, OSError):
                pass

    def _save(self):
        """Persist current config to disk."""
        try:
            persist = dict(self._data)
            # Keep legacy key in file for older tooling compatibility.
            persist["benchmarking"] = "off" if persist["benchmarking_mode"] == "off" else "on"
            with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(persist, f, indent=2)
        except OSError:
            pass

    def get(self, key: str) -> str:
        with self._lock:
            return self._data.get(key, _DEFAULTS.get(key, ""))

    def set(self, key: str, value: str) -> bool:
        """Set a config value. Returns True if valid and applied."""
        if key not in _VALID:
            return False
        if value not in _VALID[key]:
            return False
        normalized_key = "benchmarking_mode" if key == "benchmarking" else key
        normalized_value = value
        if key == "benchmarking":
            normalized_value = "standard" if value == "on" else "off"
        with self._lock:
            self._data[normalized_key] = normalized_value
            self._save()
        return True

    def all(self) -> dict:
        with self._lock:
            data = dict(self._data)
            # Expose both keys so legacy admin clients keep working.
            data["benchmarking"] = "off" if data["benchmarking_mode"] == "off" else "on"
            return data

    @property
    def benchmarking_enabled(self) -> bool:
        return self.benchmarking_mode != "off"

    @property
    def deep_benchmark_enabled(self) -> bool:
        return self.benchmarking_mode == "deep_stack_11"

    @property
    def benchmarking_mode(self) -> str:
        return self.get("benchmarking_mode")

    @property
    def profiling_enabled(self) -> bool:
        return self.get("profiling") == "on"

    @property
    def logging_level(self) -> str:
        return self.get("logging")


# Singleton
config = AppConfig()
