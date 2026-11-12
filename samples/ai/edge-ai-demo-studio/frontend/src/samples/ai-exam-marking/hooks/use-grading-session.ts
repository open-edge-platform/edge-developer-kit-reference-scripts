// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState } from 'react'
import { useServiceApiBase } from '@/context/service-status-context'
import {
  DEFAULT_LLM_PROMPT,
  DEFAULT_OCR_PROMPT,
} from '@/samples/ai-exam-marking/lib/prompts'
import type {
  ArchiveRequest,
  DataEntry,
  GradingEntry,
  SavedRecord,
  Subject,
} from '@/samples/ai-exam-marking/lib/types'
import { releaseInflightSource, useArchiveResult } from './use-archive-result'
import { useGradingPipeline } from './use-grading-pipeline'
import { useSerialQueue } from './use-serial-queue'

type QueueItem = { id: string; dataUrl: string; sourceFilename?: string }

const SAVE_FAILED_ERROR =
  'Graded, but saving to the exam database failed. Make sure the Exam Marking Database service is running, then retry.'

/**
 * A 10-digit id; it names the sheet until its student ID is read. Converts the full UUID to a
 * decimal number rather than stripping non-digit hex characters, which discarded most of its
 * randomness and let different uploads collide into one record.
 */
function newEntryId(length = 10): string {
  const hex = crypto.randomUUID().replace(/-/g, '')
  return BigInt(`0x${hex}`).toString().slice(-length).padStart(length, '0')
}

export interface GradingPrompts {
  ocrPrompt: string
  setOcrPrompt: (prompt: string) => void
  llmPrompt: string
  setLlmPrompt: (prompt: string) => void
}

/**
 * The sheets being graded, their prompts and the one-at-a-time queue. Held above the demo's tabs so
 * grading carries on while another tab is shown.
 */
export function useGradingSession({
  dataEntries,
  subject,
  saveRecord,
}: {
  dataEntries: DataEntry[]
  subject: Subject
  /** Resolves false when the exam database did not store the record. */
  saveRecord: (record: SavedRecord) => Promise<boolean>
}) {
  const [entries, setEntries] = useState<GradingEntry[]>([])
  const [ocrPrompt, setOcrPrompt] = useState(DEFAULT_OCR_PROMPT)
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT)
  // Scanned files queued or being graded, so the watcher resending one is ignored.
  const inFlightSourcesRef = useRef(new Set<string>())

  const agentApiBase = useServiceApiBase('exam-marking-agent')
  const { mutateAsync: archiveResult } = useArchiveResult(agentApiBase)

  const updateEntry = (id: string, patch: Partial<GradingEntry>) =>
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )

  const removeEntry = (id: string) => {
    const entry = entries.find((e) => e.id === id)
    // Unsaved papers stay locked in prior_mark; unlock so the watcher can resend them.
    if (entry?.pendingRecord) {
      releaseInflightSource(agentApiBase, entry.sourceFilename)
    }
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  /** Files the graded sheet with the agent; on failure the request stays on the entry for a retry. */
  const archiveEntry = async (
    entryId: string,
    req: ArchiveRequest,
  ): Promise<boolean> => {
    try {
      await archiveResult(req)
      updateEntry(entryId, { pendingArchive: undefined, error: undefined })
      return true
    } catch {
      updateEntry(entryId, {
        pendingArchive: req,
        error:
          'Graded and saved, but archiving the result failed. Please retry.',
      })
      return false
    }
  }

  /** Saves `record` (when given), then archives the sheet; what fails is kept for a retry. */
  const finalizeEntry = async (
    entryId: string,
    archive: ArchiveRequest,
    record?: SavedRecord,
  ) => {
    if (record) {
      updateEntry(entryId, { step: { phase: 'saving' }, error: undefined })
      if (!(await saveRecord(record))) {
        // Keep the paper locked in prior_mark so the watcher doesn't resend and re-grade it;
        // retry saves this record and then archives it.
        updateEntry(entryId, {
          step: null,
          pendingRecord: record,
          pendingArchive: archive,
          error: SAVE_FAILED_ERROR,
        })
        return
      }
      updateEntry(entryId, { pendingRecord: undefined })
    }
    updateEntry(entryId, { step: { phase: 'archiving' }, error: undefined })
    await archiveEntry(entryId, archive)
    updateEntry(entryId, { step: null })
  }

  const { processImage } = useGradingPipeline({
    dataEntries,
    subject,
    ocrPrompt,
    llmPrompt,
    updateEntry,
    finalizeEntry,
    releaseSource: (filename) => releaseInflightSource(agentApiBase, filename),
  })
  const { enqueue } = useSerialQueue<QueueItem>(
    ({ id, dataUrl, sourceFilename }) =>
      processImage(
        id,
        dataUrl,
        dataUrl.split(',')[1] ?? '',
        sourceFilename,
      ).finally(() => {
        if (sourceFilename) inFlightSourcesRef.current.delete(sourceFilename)
      }),
  )

  const queue = (item: QueueItem) => {
    if (item.sourceFilename) inFlightSourcesRef.current.add(item.sourceFilename)
    enqueue(item)
  }

  /** Adds a sheet (a data URL) and queues it for grading; `sourceFilename` names a scanned one. */
  const addImage = (dataUrl: string, sourceFilename?: string) => {
    if (sourceFilename && inFlightSourcesRef.current.has(sourceFilename)) return
    const id = newEntryId()
    setEntries((prev) => [
      ...prev,
      {
        id,
        uploadedImage: dataUrl,
        annotatedImage: '',
        step: { phase: 'queued' },
        sourceFilename,
      },
    ])
    queue({ id, dataUrl, sourceFilename })
  }

  /** Retries what failed: saving or archiving a graded sheet, else grading it again. */
  const retryEntry = (entry: GradingEntry) => {
    if (entry.pendingArchive) {
      finalizeEntry(entry.id, entry.pendingArchive, entry.pendingRecord)
      return
    }
    updateEntry(entry.id, { step: { phase: 'queued' }, error: undefined })
    queue({
      id: entry.id,
      dataUrl: entry.uploadedImage,
      sourceFilename: entry.sourceFilename,
    })
  }

  const prompts: GradingPrompts = {
    ocrPrompt,
    setOcrPrompt,
    llmPrompt,
    setLlmPrompt,
  }

  return {
    entries,
    subject,
    updateEntry,
    removeEntry,
    addImage,
    retryEntry,
    archiveEntry,
    prompts,
  }
}

export type GradingSession = ReturnType<typeof useGradingSession>
