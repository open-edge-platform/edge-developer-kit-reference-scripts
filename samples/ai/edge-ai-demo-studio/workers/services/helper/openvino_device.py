# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""List OpenVINO devices (``AUTO`` first) as JSON for the app's device picker.

stdout is the JSON, so nothing else may print there.
"""

import json

from worker_common.devices import openvino_devices


def query_device():
    return [{"id": d["name"], "name": d["full_name"]} for d in openvino_devices()]


if __name__ == "__main__":
    print(json.dumps(query_device(), indent=2))
