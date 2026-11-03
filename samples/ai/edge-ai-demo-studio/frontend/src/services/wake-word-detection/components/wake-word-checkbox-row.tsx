// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One row of the wake word multi-select: a row-sized checkbox with name, hint and badge. */
export function WakeWordCheckboxRow({
  value,
  label,
  hint,
  badge,
  checked,
  onToggle,
}: {
  value: string
  label: string
  hint?: string
  badge?: ReactNode
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-testid={`cfg-wake-word-${value}`}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
        checked
          ? 'border-primary bg-primary/5'
          : 'border-border hover:bg-muted/50',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
            checked
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/40',
          )}
        >
          {checked && <Check className="h-2.5 w-2.5" />}
        </span>
        <span className="truncate font-medium">{label}</span>
        {hint && (
          <span className="text-muted-foreground/70 truncate">{hint}</span>
        )}
      </span>
      {badge}
    </button>
  )
}
