# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO device discovery and validation.

A single shared :class:`openvino.Core` is reused across every model so we only
query the runtime once.
"""

from __future__ import annotations

import logging
from typing import Any

import openvino as ov

logger = logging.getLogger(__name__)

# "AUTO" lets OpenVINO pick the best plugin; the others are explicit targets.
SUPPORTED_DEVICES = {"AUTO", "CPU", "GPU", "NPU"}

_core: ov.Core | None = None


def get_core() -> ov.Core:
    """Return the process-wide OpenVINO Core (created on first use)."""
    global _core
    if _core is None:
        _core = ov.Core()
    return _core


def get_available_devices() -> list[dict[str, Any]]:
    """List the physical OpenVINO devices present on this machine."""
    try:
        core = get_core()
        devices = []
        for name in core.available_devices:
            try:
                full_name = core.get_property(name, "FULL_DEVICE_NAME")
            except Exception:
                full_name = name
            if name.startswith("GPU"):
                dev_type = "GPU"
            elif name.startswith("NPU"):
                dev_type = "NPU"
            else:
                dev_type = "CPU"
            devices.append(
                {"name": name, "full_name": full_name, "type": dev_type}
            )
        logger.info(
            "[DEVICE] Available: "
            + ", ".join(f"{d['name']} ({d['full_name']})" for d in devices)
        )
        return devices
    except Exception as exc:
        logger.warning(f"[DEVICE] Could not query OpenVINO devices: {exc}")
        return [{"name": "CPU", "full_name": "CPU (fallback)", "type": "CPU"}]


def normalize_device(device: str | None) -> str:
    """Validate and canonicalise a requested device string.

    A bare base name (``GPU``, ``AUTO``, ``CPU``, ``NPU``) is upper-cased and
    checked against the supported set. Indexed names such as ``GPU.1`` are
    accepted as-is so multi-GPU systems can target a specific tile.
    """
    if not device:
        return "AUTO"
    cleaned = device.strip()
    base = cleaned.split(".")[0].upper()
    if base not in SUPPORTED_DEVICES:
        raise ValueError(
            f"Unsupported device '{device}'. "
            f"Must be one of {sorted(SUPPORTED_DEVICES)} (optionally with an "
            f"index, e.g. 'GPU.1')."
        )
    # Preserve the index suffix but upper-case the base (gpu.1 -> GPU.1).
    return base if "." not in cleaned else f"{base}.{cleaned.split('.', 1)[1]}"
