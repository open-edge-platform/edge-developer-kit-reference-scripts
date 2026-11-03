// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'

export interface DraftState<T> {
  draft: T
  /** Shallow-merges `patch` into the draft. */
  setDraft: (patch: Partial<T>) => void
  /** Restores the draft to the latest `current`. */
  reset: () => void
}

/** Draft of a Configure panel field group: starts at `current`, edited locally until saved or reset. */
export function useDraftState<T extends object>(current: T): DraftState<T> {
  const [draft, setDraftState] = useState<T>(current)

  const setDraft = (patch: Partial<T>) =>
    setDraftState((prev) => ({ ...prev, ...patch }))
  const reset = () => setDraftState(current)

  return { draft, setDraft, reset }
}
