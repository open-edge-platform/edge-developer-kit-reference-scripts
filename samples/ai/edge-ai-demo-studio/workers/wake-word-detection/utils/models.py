# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Data models for wake word detection service."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, HttpUrl
from sqlmodel import Field, SQLModel


class WebhookSubscriber(SQLModel, table=True):
    """Database model for webhook subscribers."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    url: str = Field(index=True, unique=True)
    threshold: float = Field(default=0.6)
    api_key: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.now)


class WebhookSubscription(BaseModel):
    """Request model for webhook subscription."""

    url: HttpUrl
    name: Optional[str] = None
    threshold: Optional[float] = 0.6
    api_key: Optional[str] = None


class DetectionEvent(BaseModel):
    """Detection event sent to webhooks."""

    event: str = "wake_word_detected"
    model: str
    score: float
    timestamp: str
    message: str


class ModelReloadRequest(BaseModel):
    """Request model for reloading models."""

    model_filenames: list[str]
    vad_threshold: float = 0.2


class DetectionStartRequest(BaseModel):
    """Request model for starting detection."""

    device_id: int = -1  # Audio input device ID / -1 for 'sysdefault'
    threshold: float = 0.5  # Detection score threshold (0.0–1.0)
