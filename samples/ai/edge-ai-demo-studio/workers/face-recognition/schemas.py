# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Pydantic request models for the face-recognition worker."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LoadModelRequest(BaseModel):
    model: str
    device: str | None = None
    options: dict[str, Any] | None = None
