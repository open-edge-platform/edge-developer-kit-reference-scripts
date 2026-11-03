// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import {
  isCpuAffinityValid,
  normalizeCpuAffinity,
} from '@/lib/instances/cpu-affinity'

export interface CpuAffinityDraft {
  draft: string
  setDraft: (next: string) => void
  /** `draft` with whitespace stripped — the form persisted to the backend. */
  normalized: string
  /** True when `normalized` differs from the (also normalized) current value. */
  changed: boolean
  valid: boolean
  /** Restores `draft` to the latest `current`. */
  reset: () => void
}

/** Draft state for a CPU affinity picker, edited against the persisted `current` value. */
export function useCpuAffinityDraft(current: string): CpuAffinityDraft {
  const [draft, setDraft] = useState(current)
  const normalized = normalizeCpuAffinity(draft)
  const reset = () => setDraft(current)

  return {
    draft,
    setDraft,
    normalized,
    changed: normalized !== normalizeCpuAffinity(current),
    valid: isCpuAffinityValid(draft),
    reset,
  }
}
