# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Request models for the PaddleOCR worker API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LoadModelRequest(BaseModel):
    """Bring up (and switch to) a model from the registry."""

    model: str
    device: str | None = None
    # Per-preset option overrides (e.g. custom model URLs, VL repo id,
    # max_new_tokens, quantisation flags).
    options: dict[str, Any] | None = None


class CameraStartRequest(BaseModel):
    """Start the server-side camera capture loop."""

    source: str | None = None  # webcam index, file path, or RTSP/HTTP URL
