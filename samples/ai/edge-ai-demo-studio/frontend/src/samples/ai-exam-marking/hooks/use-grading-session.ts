// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_LLM_PROMPT,
  DEFAULT_OCR_PROMPT,
} from '@/samples/ai-exam-marking/lib/prompts'
import type {
  DataEntry,
  GradingEntry,
  SavedRecord,
} from '@/samples/ai-exam-marking/lib/types'
import { useGradingPipeline } from './use-grading-pipeline'
import { useSerialQueue } from './use-serial-queue'

type QueueItem = { id: string; dataUrl: string }

/** An 8-digit id; it names the sheet until its student ID is read. */
const newEntryId = () => uuidv4().replace(/\D/g, '').slice(-8).padStart(8, '0')

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
  saveRecord,
}: {
  dataEntries: DataEntry[]
  saveRecord: (record: SavedRecord) => void
}) {
  const [entries, setEntries] = useState<GradingEntry[]>([])
  const [ocrPrompt, setOcrPrompt] = useState(DEFAULT_OCR_PROMPT)
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT)

  const updateEntry = (id: string, patch: Partial<GradingEntry>) =>
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )

  const removeEntry = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id))

  const { processImage } = useGradingPipeline({
    dataEntries,
    ocrPrompt,
    llmPrompt,
    updateEntry,
    saveRecord,
  })
  const { enqueue } = useSerialQueue<QueueItem>(({ id, dataUrl }) =>
    processImage(id, dataUrl, dataUrl.split(',')[1] ?? ''),
  )

  /** Adds a sheet (a data URL) and queues it for grading. */
  const addImage = (dataUrl: string) => {
    const id = newEntryId()
    setEntries((prev) => [
      ...prev,
      {
        id,
        uploadedImage: dataUrl,
        annotatedImage: '',
        step: { phase: 'queued' },
      },
    ])
    enqueue({ id, dataUrl })
  }

  const retryEntry = (id: string, uploadedImage: string) => {
    updateEntry(id, { step: { phase: 'queued' }, error: undefined })
    enqueue({ id, dataUrl: uploadedImage })
  }

  const prompts: GradingPrompts = {
    ocrPrompt,
    setOcrPrompt,
    llmPrompt,
    setLlmPrompt,
  }

  return { entries, updateEntry, removeEntry, addImage, retryEntry, prompts }
}

export type GradingSession = ReturnType<typeof useGradingSession>
