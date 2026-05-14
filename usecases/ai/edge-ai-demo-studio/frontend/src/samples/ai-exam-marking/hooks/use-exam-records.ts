// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import type { SavedRecord } from '@/lib/ai-exam-marking/types'

export function useExamRecords() {
  const [records, setRecords] = useState<SavedRecord[]>([])

  const saveRecord = useCallback((record: SavedRecord) => {
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
  }, [])

  const deleteRecord = useCallback(
    (id: string) => {
      const found = records.some((r) => r.id === id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
      return found
    },
    [records],
  )

  const deleteAllRecords = useCallback(() => {
    setRecords([])
  }, [])

  return { records, saveRecord, deleteRecord, deleteAllRecords }
}
