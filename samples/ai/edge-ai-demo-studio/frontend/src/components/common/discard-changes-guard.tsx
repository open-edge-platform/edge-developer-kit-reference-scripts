// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ReactNode, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'

/**
 * Keeps a dialog, sheet or form from silently dropping unsaved edits. Route every way of closing it
 * through `guard(close)`, which asks first when `dirty`; a successful save closes directly. Render
 * `dialog` next to the guarded content.
 */
export function useDiscardGuard({
  dirty,
  onDiscard,
  description = 'Your changes have not been saved and will be lost.',
}: {
  dirty: boolean
  /** Resets the draft; runs only when the user chose to discard. */
  onDiscard?: () => void
  description?: string
}): { guard: (close: () => void) => void; dialog: ReactNode } {
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null)

  const guard = (close: () => void) => {
    if (dirty) setPendingClose(() => close)
    else close()
  }

  const dialog = (
    <ConfirmDialog
      open={pendingClose !== null}
      onOpenChange={(open) => {
        if (!open) setPendingClose(null)
      }}
      title="Discard unsaved changes?"
      description={description}
      variant="destructive"
      cancelLabel="Keep editing"
      confirmLabel="Discard changes"
      data-testid="discard-changes-dialog"
      confirmTestId="discard-changes-confirm"
      cancelTestId="discard-changes-cancel"
      onConfirm={() => {
        onDiscard?.()
        pendingClose?.()
      }}
    />
  )

  return { guard, dialog }
}
