// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import type { ImageRun } from '../lib/image-job'

const ICON = (
  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
)

/** Why the last request did not produce an image, above whatever is kept. */
export function RunOutcome({
  run,
  noun,
  onReconnect,
  canReconnect,
}: {
  run: ImageRun
  /** `Generation` or `Edit`. */
  noun: string
  onReconnect: () => void
  canReconnect: boolean
}) {
  if (run.phase === 'failed') {
    return (
      <InlineNotice
        tone="destructive"
        data-testid="imggen-error"
        className="items-start"
        icon={ICON}
      >
        <span className="block font-medium">{noun} failed</span>
        {run.error && <span className="block break-words">{run.error}</span>}
      </InlineNotice>
    )
  }
  if (run.phase === 'cancelled') {
    return (
      <p
        role="status"
        data-testid="imggen-cancelled"
        className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-2 text-xs"
      >
        {noun} cancelled
      </p>
    )
  }
  if (run.phase !== 'lost') return null
  return (
    <InlineNotice
      tone="warning"
      role="alert"
      data-testid="imggen-job-lost"
      className="items-start"
      icon={ICON}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onReconnect}
          disabled={!canReconnect}
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Check again
        </Button>
      }
    >
      <span className="block font-medium">
        Lost track of this {noun.toLowerCase()}
      </span>
      <span className="block break-words">
        {run.error ? `${run.error} ` : ''}It was not sent again.
      </span>
    </InlineNotice>
  )
}
