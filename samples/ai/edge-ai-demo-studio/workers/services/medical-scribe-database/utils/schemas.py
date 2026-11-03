# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Optional, List, Dict, Any
from pydantic import BaseModel


class DoctorProfileCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str


class DoctorProfileEmbeddingRequest(BaseModel):
    embedding: List[float]


class SessionCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str
    doctorProfileId: Optional[str] = None
    language: str = "en"
    sessionCreatedAt: Optional[str] = None


class SessionUpdateRequest(BaseModel):
    name: Optional[str] = None
    doctorProfileId: Optional[str] = None
    language: Optional[str] = None
    status: Optional[str] = None
    transcripts: Optional[List[Dict[str, Any]]] = None
    soapReport: Optional[str] = None
    errorMessage: Optional[str] = None
    dialogueCreatedAt: Optional[str] = None
    reportCreatedAt: Optional[str] = None
