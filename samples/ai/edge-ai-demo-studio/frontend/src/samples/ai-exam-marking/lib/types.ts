// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type BoundingBox = {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Each subject's stored ID and the kind of answers its questions take. */
export const SUBJECTS = {
  Mathematics: ['S0001', 'math'],
  'Business Studies': ['S0006', 'text'],
} as const

export type Subject = keyof typeof SUBJECTS

/** Reverse-lookup a subject label from stored subject ID (e.g. S0001). */
export function getSubjectLabel(subjectId?: string): string {
  if (!subjectId) return 'Unknown Subject'
  const match = Object.entries(SUBJECTS).find(([, [id]]) => id === subjectId)
  return match?.[0] ?? subjectId
}

export type QuestionType = 'text' | 'math'

export type DataEntry = {
  id: string
  number: number
  question: string
  marks: number
  scheme: string
  type?: QuestionType
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
  /** Stored subject ID (`SUBJECTS`); see `getSubjectLabel`. */
  subjectId?: string
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
  | { phase: 'saving' }
  | { phase: 'archiving' }

/** A graded sheet for the Exam Marking Agent to file away with its annotated image. */
export type ArchiveRequest = {
  /** Set only when the paper came from prior_mark and must be moved to marked. */
  sourceFilename?: string
  originalFilename: string
  annotatedImage: string
  annotatedFilename: string
  studentId?: string
  subject?: string
}

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
  /** The file name in the agent's prior_mark folder, for a sheet the scanner sent. */
  sourceFilename?: string
  /** Graded record the exam database has not confirmed yet; retry saves it before archiving. */
  pendingRecord?: SavedRecord
  /** Set when grading was saved but archiving failed; retry re-sends only this. */
  pendingArchive?: ArchiveRequest
}
