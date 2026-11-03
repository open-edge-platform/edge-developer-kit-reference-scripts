// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Mic, MicOff, Square } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { cn } from '@/lib/utils'

const BAR_IDS = Array.from({ length: 24 }, (_, i) => `bar-${i}`)

// A fixed shape and rhythm for the bars while audio is being processed.
const PROCESSING_BAR_HEIGHTS = [
  6, 10, 14, 18, 22, 18, 14, 10, 8, 12, 16, 20, 16, 12, 8, 6, 10, 14, 18, 14,
  10, 8, 6, 4,
]
const PROCESSING_ANIM_DURATIONS = [
  0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3,
  0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.4,
]

interface RecordControlProps {
  /** Recording or listening: the button stops. */
  active: boolean
  /** Audio is being processed; the button waits. */
  busy: boolean
  /** The microphone captures: the bars follow `levels`. */
  capturing: boolean
  levels: number[]
  /** Live mode: the worker's VAD hears speech (ring grows; bars dim when false). Unset for batch. */
  speech?: boolean
  status: string
  micError: string | null
  onToggle: () => void
}

/**
 * Record button with level bars. Pointer target only: keyboard and screen reader users have the
 * labelled Record / Stop button beside the upload.
 */
export function RecordControl({
  active,
  busy,
  capturing,
  levels,
  speech,
  status,
  micError,
  onToggle,
}: RecordControlProps) {
  return (
    <div className="border-border bg-muted/20 flex flex-col items-center justify-center rounded-xl border p-8">
      {micError && (
        <InlineNotice
          tone="destructive"
          size="sm"
          className="mb-4"
          icon={<MicOff aria-hidden className="h-3.5 w-3.5 shrink-0" />}
        >
          {micError}
        </InlineNotice>
      )}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggle}
        disabled={busy}
        data-testid="stt-record-button"
        className={cn(
          'flex h-20 w-20 items-center justify-center rounded-full transition-all',
          active
            ? cn(
                'bg-destructive/15 text-destructive scale-110',
                speech
                  ? 'ring-destructive/50 ring-8'
                  : 'ring-destructive/30 ring-4',
              )
            : 'bg-primary/15 text-primary hover:bg-primary/25',
          busy && 'cursor-not-allowed opacity-50',
        )}
      >
        {active ? <Square className="h-7 w-7" /> : <Mic className="h-8 w-8" />}
      </button>

      <p className="text-muted-foreground mt-3 text-sm">{status}</p>

      <div aria-hidden="true" className="mt-4 flex h-12 items-end gap-[3px]">
        {BAR_IDS.map((barId, i) => (
          <div
            key={barId}
            className={cn(
              'w-1 rounded-full transition-all duration-150',
              capturing
                ? speech === false
                  ? 'bg-destructive/30'
                  : 'bg-destructive/70'
                : busy
                  ? 'bg-info'
                  : 'bg-muted-foreground/20',
            )}
            style={{
              height: capturing
                ? `${levels[i]}px`
                : busy
                  ? `${PROCESSING_BAR_HEIGHTS[i]}px`
                  : '4px',
              transition: capturing ? 'none' : undefined,
              animation: busy
                ? `pulse-status ${PROCESSING_ANIM_DURATIONS[i]}s ease-in-out infinite`
                : 'none',
            }}
          />
        ))}
      </div>
    </div>
  )
}
