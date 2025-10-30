# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import torch
import openvino as ov
import json


def query_device():
    devices = []
    core = ov.Core()

    cpu_name = core.get_property("CPU", "FULL_DEVICE_NAME")
    devices.append({"id": "cpu", "name": cpu_name})

    # Check for GPUs
    if torch.xpu.is_available():
        gpu_count = torch.xpu.device_count()
        for i in range(gpu_count):
            device_id = f"xpu:{i}"
            device_name = torch.xpu.get_device_name(i)
            devices.append({"id": device_id, "name": device_name})
    else:
        print("No GPUs detected, only CPU is available.")

    return devices


if __name__ == "__main__":
    devices = query_device()
    print(json.dumps(devices, indent=2))
