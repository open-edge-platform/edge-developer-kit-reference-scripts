// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'

export interface ConfigureSheetState {
  /** The Runtime Settings sheet is open. */
  open: boolean
  /** Open, or drafting inline in the New instance sheet: fetch what only a visible panel needs. */
  active: boolean
  /** Rendered inline under a configure draft host (no sheet). */
  isDraft: boolean
  /** Resets the draft, then opens/closes; the sheet closes only once unsaved changes are saved or discarded. */
  onOpenChange: (open: boolean) => void
  /** Closes after a successful save (resets the draft too). */
  close: () => void
}

/**
 * Open state of a Configure sheet, controlled (a multi-engine dispatcher keeps it across the panel
 * swap) or not. `reset` runs both when the sheet opens and when it closes.
 */
export function useConfigureSheet({
  open: controlledOpen,
  onOpenChange,
  reset,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  reset: () => void
}): ConfigureSheetState {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const isDraft = useConfigureDraftHost() !== null
  const change = (next: boolean) => {
    reset()
    setOpen(next)
  }
  return {
    open,
    active: open || isDraft,
    isDraft,
    onOpenChange: change,
    close: () => change(false),
  }
}
