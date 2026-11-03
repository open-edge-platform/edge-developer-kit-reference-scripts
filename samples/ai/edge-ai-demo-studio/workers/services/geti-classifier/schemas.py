# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Any
from pydantic import BaseModel
from core.device_manager import DEFAULT_DEVICE


class FeedbackRequest(BaseModel):
    host: str
    token: str
    image_id: str
    label_name: str
    is_correct: bool
    verify_ssl: bool = False


class FeedbackResponse(BaseModel):
    status: str
    action: str
    geti_image_id: str
    training_triggered: bool
    training_tasks: list[str]


class ProjectsRequest(BaseModel):
    host: str
    token: str
    verify_ssl: bool = False


class ProjectsResponse(BaseModel):
    status: str
    projects: list[dict[str, Any]]
    total: int


class ModelsRequest(BaseModel):
    host: str
    token: str
    project_id: str | None = None
    project_name: str | None = None
    verify_ssl: bool = False


class ModelsResponse(BaseModel):
    status: str
    models: list[dict[str, Any]]
    total: int


class SetupRequest(BaseModel):
    host: str
    token: str
    project_id: str | None = None
    project_name: str | None = None
    model_id: str | None = None
    verify_ssl: bool = False
    device: str = DEFAULT_DEVICE


class SetupResponse(BaseModel):
    status: str
    project_id: str
    project_name: str
    labels: list[str]
    model_name: str
    model_version: int | None
    model_score: float | None
    device: str
    requested_device: str
    device_confirmed: bool
    message: str


class DeviceChangeRequest(BaseModel):
    device: str


class AutoSyncToggleRequest(BaseModel):
    enabled: bool