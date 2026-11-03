// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface JobProgressProps {
  /** What the job is doing, e.g. "Generating frames". */
  label: string
  /** Waiting for its turn on the worker. */
  queued?: boolean
  /** While queued: the jobs still to start, this one included. */
  position?: number
  /** 0–100 while running; leave unset when the job reports none. */
  percent?: number
  /** A line under the bar, e.g. "12 of ~40 frames". */
  detail?: ReactNode
  /** A cancel was asked for and the job has not stopped yet. */
  cancelling?: boolean
  /** Shows a Cancel button. */
  onCancel?: () => void
  className?: string
}

/** A background job's queue position, progress or cancelling state, with an optional Cancel button. */
export function JobProgress({
  label,
  queued = false,
  position,
  percent,
  detail,
  cancelling = false,
  onCancel,
  className,
}: JobProgressProps) {
  const rounded = percent === undefined ? undefined : Math.round(percent)
  const text = cancelling
    ? 'Cancelling…'
    : queued
      ? `Waiting in queue${position ? ` (position ${position})` : ''}…`
      : `${label}…${rounded === undefined ? '' : ` ${rounded}%`}`

  return (
    <div
      className={cn(
        'flex w-full max-w-xs flex-col items-center gap-2',
        className,
      )}
      data-testid="job-progress"
    >
      <Progress
        value={cancelling || queued ? null : rounded}
        aria-label={label}
        className="w-full"
      />
      <p
        role="status"
        className="text-muted-foreground text-center text-xs"
        data-testid="job-progress-text"
      >
        {text}
      </p>
      {detail && !cancelling && !queued && (
        <p className="text-muted-foreground text-center text-xs">{detail}</p>
      )}
      {onCancel && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? <Loader className="animate-spin" /> : <X />}
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    </div>
  )
}
