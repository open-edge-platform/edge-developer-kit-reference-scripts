# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Select an available OpenVINO device for model inference."""


def resolve_device(device: str, available_devices: list[str]) -> str:
    requested = device.strip().upper()
    family = requested.split(".", 1)[0]
    if family not in {"GPU", "NPU"}:
        return requested
    available = {name.upper() for name in available_devices}
    if requested in available or (
        requested == family and any(name.startswith(f"{family}.") for name in available)
    ):
        return requested
    print(f"[WARN] OpenVINO device {requested} is unavailable; using CPU")
    return "CPU"