// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import type { SavedRecord } from '@/samples/ai-exam-marking/lib/types'

/** The graded sheets' History records, newest first; in memory only, nothing is saved to disk. */
export function useExamRecords() {
  const [records, setRecords] = useState<SavedRecord[]>([])

  /** Adds a record, or replaces the one with its id (a regraded sheet). */
  const saveRecord = (record: SavedRecord) =>
    setRecords((prev) => {
      const existingIndex = prev.findIndex((r) => r.id === record.id)
      const next =
        existingIndex >= 0
          ? prev.map((r, i) => (i === existingIndex ? record : r))
          : [record, ...prev]

      return next.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
    })

  return {
    records,
    saveRecord,
    deleteRecord: (id: string) =>
      setRecords((prev) => prev.filter((r) => r.id !== id)),
    deleteAllRecords: () => setRecords([]),
  }
}
