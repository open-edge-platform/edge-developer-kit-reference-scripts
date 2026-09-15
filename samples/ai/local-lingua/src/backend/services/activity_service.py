# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Tracks which pipeline stage is currently inferring on which device.

Feeds the per-device activity labels rendered under the hardware utilization
graphs (CPU/GPU/NPU). Purely in-memory — nothing is persisted and no user data
is recorded, only the stage name and the device it ran on.

Inference calls are often shorter than the 1-second telemetry tick, so a
finished stage lingers briefly before disappearing. Without that the UI would
never catch short bursts like sentiment classification.
"""

import logging
import threading
import time
from contextlib import contextmanager
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

# How long a finished stage keeps showing after its last inference completed.
LINGER_SECONDS = 2.0

# Pipeline stage -> label shown in the UI
STAGE_LABELS = {
    "transcription": "Transcription",
    "translation": "Translation",
    "sentiment": "Sentiment",
    "text_to_speech": "Text-to-Speech",
    "voice_emotion": "Voice Emotion",
}

_VALID_DEVICES = ("CPU", "GPU", "NPU")

_lock = threading.Lock()

# (device, stage) -> {"count": int, "finishedAt": float}
_state: Dict[Tuple[str, str], Dict[str, float]] = {}


def _normalize_device(device: str) -> str:
    """Map an OpenVINO device string ("GPU.0", "cpu") to CPU/GPU/NPU."""
    if not device:
        return "CPU"
    base = str(device).split(".")[0].strip().upper()
    return base if base in _VALID_DEVICES else "CPU"


@contextmanager
def track_inference(stage: str, device: str):
    """Mark `stage` as actively inferring on `device` for the duration of the block."""
    key = (_normalize_device(device), stage)

    with _lock:
        entry = _state.setdefault(key, {"count": 0, "finishedAt": 0.0})
        entry["count"] += 1

    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        with _lock:
            entry = _state.get(key)
            if entry is not None:
                entry["count"] = max(int(entry["count"]) - 1, 0)
                entry["finishedAt"] = time.monotonic()
        logger.debug("%s inference on %s took %.1f ms", stage, key[0], elapsed_ms)


def get_device_activity() -> Dict[str, List[str]]:
    """Return the stage labels currently active per device.

    Example: ``{"CPU": ["Transcription"], "GPU": ["Translation"], "NPU": []}``
    """
    now = time.monotonic()
    result: Dict[str, List[str]] = {d: [] for d in _VALID_DEVICES}

    with _lock:
        for (device, stage), entry in list(_state.items()):
            running = entry["count"] > 0
            lingering = (now - entry["finishedAt"]) < LINGER_SECONDS
            if not running and not lingering:
                # Fully idle — drop so the dict does not grow unbounded
                if entry["finishedAt"] and (now - entry["finishedAt"]) > 60:
                    _state.pop((device, stage), None)
                continue
            label = STAGE_LABELS.get(stage, stage.replace("_", " ").title())
            bucket = result.setdefault(device, [])
            if label not in bucket:
                bucket.append(label)

    return result


def reset() -> None:
    """Clear all tracked activity (test helper)."""
    with _lock:
        _state.clear()
