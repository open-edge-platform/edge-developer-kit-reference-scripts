// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Loader } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatSeconds } from '@/lib/browser/format'
import type { ImageRun } from '../lib/image-job'
import { estimatedProgress, queueHint } from '../lib/job-estimate'

/** Whole seconds as `45s` / `2m 30s`. */
const formatTime = (seconds: number) => formatSeconds(Math.round(seconds))

/** The bar follows the worker's time estimate and never reaches 100 %: the image arriving does. */
export function RunProgress({
  run,
  verb,
  onCancel,
}: {
  run: ImageRun
  /** `Generating` or `Editing`. */
  verb: string
  onCancel: () => void
}) {
  const status = run.status
  const started = status?.status === 'in_progress'
  const queued = status?.status === 'pending'
  const cancelling = run.cancelRequested || Boolean(status?.cancel_requested)
  const elapsed = status?.elapsed_time ?? 0
  const estimate = started && status ? estimatedProgress(status) : null
  const pct = estimate?.pct ?? null

  let hint = queued
    ? queueHint(status?.position)
    : 'Waiting for the worker to start the job'
  if (started) {
    hint = estimate
      ? `Estimated ~${estimate.pct}% · about ${formatTime(estimate.remaining)} left`
      : status?.estimated_time
        ? 'Taking longer than estimated'
        : 'No time estimate for this job'
  }
  if (cancelling && started) {
    hint = 'Stops once the image in progress is done'
  }

  let label = 'Starting…'
  if (cancelling) label = 'Cancelling…'
  else if (started) label = `${verb}…`
  else if (queued) label = 'Queued…'

  return (
    <div className="space-y-1.5" data-testid="imggen-progress">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          role="status"
          className="text-foreground flex items-center gap-1.5 font-medium"
        >
          <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
          {label}
          {status && status.n > 1 && (
            <span className="text-muted-foreground font-normal">
              {status.images_done} of {status.n} images done
            </span>
          )}
        </span>
        {started && (
          <span className="text-muted-foreground font-mono tabular-nums">
            {formatTime(elapsed)}
          </span>
        )}
      </div>
      <Progress
        value={pct}
        aria-label={pct === null ? `${verb} image` : 'Estimated progress'}
        getValueLabel={(value) => `About ${value}%, estimated`}
        className="h-1.5"
        indicatorClassName={pct === null ? 'bg-primary/50' : 'duration-500'}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{hint}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          data-testid="imggen-cancel-button"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
    </div>
  )
}
