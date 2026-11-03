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

/** A marking-scheme question as a saved record keeps it. */
export type SavedDataEntry = Pick<
  DataEntry,
  'number' | 'question' | 'marks' | 'scheme'
>

export interface SavedRecord {
  id: string
  timestamp: string
  studentName?: string
  studentId?: string
  dataEntries: SavedDataEntry[]
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

/** `awarded` is `null` while not graded; `max` is `null` when the marking scheme gives none. */
export interface Marks {
  awarded: number | null
  max: number | null
}

/** Marks added up over the questions graded so far. */
export interface MarksTotal {
  awarded: number
  max: number
}

export type LLMResultEntry = {
  questionNumber: string
  extractedAnswer: string
  feedback: string
  marks: Marks
  /** The sheet's marks up to and including this question. */
  runningTotal: MarksTotal
  humanReview: boolean
}

/** Where an answer sheet is in the grading pipeline. */
export type ProcessingStep =
  | { phase: 'queued' }
  | { phase: 'extracting' }
  | { phase: 'grading'; question: number; total: number }
  | { phase: 'annotating' }

/** One answer sheet on the Grading tab. */
export interface GradingEntry {
  id: string
  studentName?: string
  studentId?: string
  uploadedImage: string
  annotatedImage: string
  overlayImage?: string
  ocrText?: string
  llmResults?: LLMResultEntry[]
  /** What the pipeline is doing to the sheet; `null` once it has settled. */
  step: ProcessingStep | null
  error?: string
  reviewed?: boolean
}
