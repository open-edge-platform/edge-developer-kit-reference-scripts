// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Transcription column: heading and state badge, source, transcript box, `actions`, and a `note`
 * on what the next run does. Without `hasText` the content is drawn as a muted placeholder.
 */
export function TranscriptPanel({
  badge,
  hasText,
  source,
  actions,
  note,
  children,
}: {
  badge?: string
  hasText: boolean
  /** What was transcribed, e.g. a file name or "Recording · 0:12". */
  source?: string
  actions?: ReactNode
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby="stt-transcript-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3
          id="stt-transcript-heading"
          className="text-foreground text-sm font-medium"
        >
          Transcription
        </h3>
        {badge && (
          <Badge variant="secondary" className="text-xs">
            {badge}
          </Badge>
        )}
      </div>
      {source && (
        <div className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="shrink-0">From</span>
          <TruncatedText
            text={source}
            className="text-foreground"
            data-testid="stt-result-source"
          />
        </div>
      )}
      <div
        data-testid="stt-transcript"
        className={cn(
          'border-border bg-muted/20 min-h-[260px] space-y-2 overflow-auto rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap',
          hasText ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
      </div>
      {actions}
      {note && (
        <p
          className="text-muted-foreground text-xs"
          data-testid="stt-result-note"
        >
          {note}
        </p>
      )}
    </section>
  )
}
