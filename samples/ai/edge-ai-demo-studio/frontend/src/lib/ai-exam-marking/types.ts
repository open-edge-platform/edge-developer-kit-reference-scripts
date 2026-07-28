// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type BoundingBox = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type DataEntry = {
  id: string
  number: number
  question: string
  marks: number
  scheme: string
  boundingBox?: BoundingBox
}

export interface SavedRecord {
  id: string
  timestamp: string
  studentName?: string
  studentId?: string
  dataEntries: Array<{
    number: string
    question: string
    marks: string
    scheme: string
  }>
  ocrResult: {
    text: string
    imagePreview?: string
    overlayImage?: string
  }
  llmResult: {
    prompt: string
    response: LLMResultEntry[]
  }
}

export type LLMResultEntry = {
  questionNumber: string
  extractedAnswer: string
  feedback: string
  marksAwardedOverMaxMarks: string
  marksAccumulatedOverMaxMarksAccumulated: string
  humanReview: boolean
}
