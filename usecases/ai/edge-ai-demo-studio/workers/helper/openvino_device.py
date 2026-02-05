# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import openvino as ov
import json


def query_device():
    devices = []
    core = ov.Core()

    available_devices = core.available_devices

    for device in available_devices:
        try:
            device_name = core.get_property(device, "FULL_DEVICE_NAME")
            devices.append({"id": device, "name": device_name})
        except Exception:
            # Fallback if FULL_DEVICE_NAME is not available
            devices.append({"id": device, "name": f"OpenVINO Device {device}"})

    return devices


if __name__ == "__main__":
    devices = query_device()
    print(json.dumps(devices, indent=2))
