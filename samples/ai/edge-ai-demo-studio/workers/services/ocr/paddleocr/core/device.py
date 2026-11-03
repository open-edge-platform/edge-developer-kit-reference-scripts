# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO device discovery and validation: thin wrappers over :mod:`worker_common.devices`."""

from __future__ import annotations

from typing import Any

from worker_common.devices import (
    normalize_openvino_device,
    openvino_core,
    openvino_devices,
)

# "AUTO" lets OpenVINO pick the best plugin; the others are explicit targets.
SUPPORTED_DEVICES = {"AUTO", "CPU", "GPU", "NPU"}


def get_core() -> Any:
    """Return the process-wide OpenVINO Core (created on first use)."""
    return openvino_core()


def get_available_devices() -> list[dict[str, Any]]:
    """List the physical OpenVINO devices present on this machine."""
    return openvino_devices()


def normalize_device(device: str | None) -> str:
    """Validate and upper-case a device name; indexed names such as ``GPU.1`` pass as-is."""
    return normalize_openvino_device(device, supported=tuple(sorted(SUPPORTED_DEVICES)), default="AUTO")
