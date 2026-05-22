# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from pydantic import BaseModel

class FocusAction(BaseModel):
    action: str
