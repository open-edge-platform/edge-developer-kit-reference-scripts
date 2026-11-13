# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Level-aware application logger for the Agentic Ultrasound Analyzer POC.

Respects the runtime config setting for logging level:
    - "off"     → no output
    - "normal"  → major activities (info level)
    - "verbose" → everything including debug details

Usage:
    from common.logger import log

    log.info("Analysis completed")          # shown in normal + verbose
    log.verbose("OVMS payload: {}", data)   # shown only in verbose
    log.error("Failed: {}", err)            # always shown (even in off mode)
"""

import sys
import datetime
import threading
from collections import deque
from common.config import config

_MAX_LOG_ENTRIES = 200


class AppLogger:
    """Simple level-aware logger that checks config on each call."""

    def __init__(self):
        self._buffer = deque(maxlen=_MAX_LOG_ENTRIES)
        self._lock = threading.Lock()

    def _should_log(self, level: str) -> bool:
        cfg_level = config.logging_level
        if level == "error":
            return True  # errors always shown
        if cfg_level == "off":
            return False
        if cfg_level == "normal":
            return level in {"info", "warning"}
        # verbose: show everything
        return True

    def _emit(self, prefix: str, msg: str, args):
        if args:
            try:
                msg = msg.format(*args)
            except (IndexError, KeyError):
                pass
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        line = f"[{ts}] {prefix} {msg}"
        print(line, flush=True)
        with self._lock:
            self._buffer.append({
                "timestamp": ts,
                "level": prefix.strip(),
                "message": msg,
            })

    def info(self, msg: str, *args):
        """Log major activities. Shown in normal and verbose modes."""
        if self._should_log("info"):
            self._emit("INFO ", msg, args)

    def verbose(self, msg: str, *args):
        """Log detailed info. Shown only in verbose mode."""
        if self._should_log("verbose"):
            self._emit("DEBUG", msg, args)

    def warning(self, msg: str, *args):
        """Log warnings. Shown in normal and verbose modes."""
        if self._should_log("warning"):
            self._emit("WARN ", msg, args)

    def error(self, msg: str, *args):
        """Log errors. Always shown regardless of config."""
        self._emit("ERROR", msg, args)

    def get_entries(self, last_n: int = 50) -> list:
        """Return the last N log entries."""
        with self._lock:
            entries = list(self._buffer)
        return entries[-last_n:]

    def clear(self):
        """Clear the log buffer."""
        with self._lock:
            self._buffer.clear()


# Singleton
log = AppLogger()
