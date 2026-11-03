// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import { type MouseEvent, type ReactNode, useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { getErrorMessage } from '@/lib/errors'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Anything between the description and the buttons, e.g. what goes away. */
  children?: ReactNode
  /** `destructive` for deletes and anything else that cannot be undone. */
  variant?: 'default' | 'destructive'
  /** Defaults to "Delete" for a destructive dialog, else "Confirm". */
  confirmLabel?: ReactNode
  /** Shown on the confirm button while `onConfirm` runs. */
  pendingLabel?: ReactNode
  cancelLabel?: ReactNode
  /**
   * A returned promise keeps the dialog open and disabled until it settles; it closes on success
   * and shows the error on rejection.
   */
  onConfirm: () => void | Promise<unknown>
  /** Disables the confirm button (e.g. a typed confirmation not matching). */
  confirmDisabled?: boolean
  'data-testid'?: string
  confirmTestId?: string
  cancelTestId?: string
}

/**
 * Confirmation for destructive or irreversible actions, in place of `window.confirm()`. Radix
 * closes an AlertDialog on action click, before an async `onConfirm` settles; this one waits.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  variant = 'default',
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  confirmDisabled = false,
  'data-testid': testId,
  confirmTestId,
  cancelTestId,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    // Escape, the overlay and Cancel all wait for a running confirm.
    if (pending) return
    if (!next) setError(null)
    onOpenChange(next)
  }

  const handleConfirm = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await onConfirm()
      setPending(false)
      onOpenChange(false)
    } catch (err) {
      setPending(false)
      setError(getErrorMessage(err, 'Something went wrong. Try again.'))
    }
  }

  const destructive = variant === 'destructive'

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        {error && (
          <InlineNotice tone="destructive" size="sm">
            {error}
          </InlineNotice>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid={cancelTestId}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending || confirmDisabled}
            aria-busy={pending || undefined}
            variant={destructive ? 'destructive' : 'default'}
            data-testid={confirmTestId}
          >
            {pending && <Loader className="animate-spin" aria-hidden />}
            {pending
              ? (pendingLabel ?? confirmLabel ?? 'Working…')
              : (confirmLabel ?? (destructive ? 'Delete' : 'Confirm'))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
