// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type {
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
    dataEntries: toSavedDataEntries(dataEntries),
    ocrResult: { text: ocrText, imagePreview: annotatedImage, overlayImage },
    llmResult: { prompt: llmPrompt, response: llmResults },
  }
}
