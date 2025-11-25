# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

def model_name_parser(model_id: str):
    parts = model_id.split(':', 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, None

