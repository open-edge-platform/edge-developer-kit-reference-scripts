# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""List torch devices (cpu plus every xpu:N) as JSON for the app's device picker.

stdout is the JSON, so nothing else may print there.
"""

import json
import sys

from worker_common.devices import torch_devices


def query_device():
    devices = torch_devices()
    if len(devices) == 1:
        print("No GPUs detected, only CPU is available.", file=sys.stderr)
    return devices


if __name__ == "__main__":
    print(json.dumps(query_device(), indent=2))
