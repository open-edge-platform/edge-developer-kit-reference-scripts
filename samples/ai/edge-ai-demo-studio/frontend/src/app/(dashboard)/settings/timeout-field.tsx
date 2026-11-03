// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatSeconds } from '@/lib/browser/format'
import { MIN_TIMEOUT_SECONDS } from '@/lib/settings/app-settings'
import { parseTimeoutDraft } from './settings-draft'

/**
 * A seconds field with an "Xm Ys" readout. The text is kept as typed and settles to a valid number
 * on blur; it is empty and disabled until `savedSeconds` loads, so a default never looks saved.
 */
export function TimeoutField({
  id,
  label,
  value,
  savedSeconds,
  onChange,
  description,
  children,
}: {
  id: string
  label: string
  value: string
  /** The stored value, what an empty or invalid text falls back to; undefined until loaded. */
  savedSeconds: number | undefined
  onChange: (value: string) => void
  description: string
  /** Notes under the description. */
  children?: ReactNode
}) {
  const loaded = savedSeconds !== undefined
  const seconds = loaded ? parseTimeoutDraft(value, savedSeconds) : undefined
  const descriptionId = `${id}-description`

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        <span className="flex items-center gap-1.5">
          <Timer aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </span>
      </Label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_TIMEOUT_SECONDS}
          step={1}
          value={loaded ? value : ''}
          disabled={!loaded}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (seconds === undefined) return
            const settled = String(seconds)
            if (settled !== value) onChange(settled)
          }}
          aria-describedby={descriptionId}
          className="bg-muted/30 w-32"
        />
        {seconds !== undefined && (
          <span className="text-muted-foreground text-sm" aria-live="polite">
            seconds ({formatSeconds(seconds)})
          </span>
        )}
      </div>
      <p id={descriptionId} className="text-muted-foreground text-xs">
        {description} Values under {MIN_TIMEOUT_SECONDS} seconds are raised to{' '}
        {MIN_TIMEOUT_SECONDS}.
      </p>
      {children}
    </div>
  )
}
