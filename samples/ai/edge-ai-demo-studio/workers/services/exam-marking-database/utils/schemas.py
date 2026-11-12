# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Optional, List
from pydantic import BaseModel


class GradingEntryRequest(BaseModel):
    questionNumber: str
    extractedAnswer: str = ""
    feedback: str = ""
    marksAwardedOverMaxMarks: str = ""
    marksAccumulatedOverMaxMarksAccumulated: str = ""
    humanReview: bool = False


class LLMResultRequest(BaseModel):
    prompt: str = ""
    response: List[GradingEntryRequest] = []


class OCRResultRequest(BaseModel):
    text: str = ""
    imagePreview: Optional[str] = None
    overlayImage: Optional[str] = None


class DataEntryRequest(BaseModel):
    number: str
    question: str
    marks: str
    scheme: str


class ExamRecordRequest(BaseModel):
    model_config = {"extra": "ignore"}

    id: Optional[str] = None
    timestamp: Optional[str] = None
    studentName: Optional[str] = None
    studentId: Optional[str] = None
    subjectId: Optional[str] = None
    dataEntries: List[DataEntryRequest] = []
    ocrResult: OCRResultRequest = OCRResultRequest()
    llmResult: LLMResultRequest = LLMResultRequest()