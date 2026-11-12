// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
  ArchiveRequest,
  DataEntry,
  LLMResultEntry,
  SavedDataEntry,
  SavedRecord,
} from './types'

/** The marking scheme as a saved record (and its PDF report) keeps it. */
export function toSavedDataEntries(
  dataEntries: readonly DataEntry[],
): SavedDataEntry[] {
  return dataEntries.map(({ number, question, marks, scheme }) => ({
    number,
    question,
    marks,
    scheme,
  }))
}

interface BuildSavedRecordParams {
  entryId: string
  studentName?: string
  studentId?: string
  /** Stored subject ID (`SUBJECTS`). */
  subjectId?: string
  dataEntries: readonly DataEntry[]
  ocrText: string
  overlayImage?: string
  annotatedImage: string
  llmPrompt: string
  llmResults: LLMResultEntry[]
}

/** The History record of a graded sheet; one whose student ID was not read is filed under its own id. */
export function buildSavedRecord({
  entryId,
  studentName,
  studentId,
  subjectId,
  dataEntries,
  ocrText,
  overlayImage,
  annotatedImage,
  llmPrompt,
  llmResults,
}: BuildSavedRecordParams): SavedRecord {
  return {
    id: entryId,
    timestamp: new Date().toISOString(),
    studentName: studentName || undefined,
    studentId: studentId || entryId || undefined,
    subjectId,
    dataEntries: toSavedDataEntries(dataEntries),
    ocrResult: { text: ocrText, imagePreview: annotatedImage, overlayImage },
    llmResult: { prompt: llmPrompt, response: llmResults },
  }
}

/**
 * What the Exam Marking Agent files for a graded sheet: a scanned one (`sourceFilename`) is moved
 * out of prior_mark; an upload or capture is stored as `<entryId>.png`.
 */
export function buildArchiveRequest({
  entryId,
  sourceFilename,
  annotatedImage,
  studentId,
  subject,
}: {
  entryId: string
  sourceFilename?: string
  annotatedImage: string
  studentId?: string
  subject: string
}): ArchiveRequest {
  const originalFilename = sourceFilename ?? `${entryId}.png`
  const stem = originalFilename.replace(/\.[^/.]+$/, '')
  return {
    sourceFilename,
    originalFilename,
    annotatedImage,
    annotatedFilename: `${stem}_annotated.png`,
    studentId: studentId || undefined,
    subject,
  }
}
