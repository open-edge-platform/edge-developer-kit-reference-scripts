// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Loader } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatSeconds } from '@/lib/browser/format'
import type { VideoStatus } from '../lib/api'
import type { VideoRun } from '../lib/video-job'

/** Whole seconds as `45s` / `2m 30s`. */
const formatTime = (seconds: number) => formatSeconds(Math.round(seconds))

/** What the worker is doing, in the user's words. */
function phaseLabel(status: VideoStatus): string {
  switch (status.phase) {
    case 'prepare':
      return 'Preparing the model for this size'
    case 'text':
      return 'Reading the prompt'
    case 'denoise':
      return status.step != null && status.steps
        ? `Denoising, step ${status.step} of ${status.steps}`
        : 'Denoising'
    case 'decode':
      return 'Decoding frames'
    case 'encode':
      return 'Encoding the MP4'
    default:
      return 'Generating'
  }
}

function queueHint(position: number | null | undefined): string {
  if (!position) return 'Waiting for the worker to start the video'
  const ahead = position - 1
  return ahead === 0
    ? 'Next in line: the worker makes one video at a time'
    : `Queued behind ${ahead} other video${ahead > 1 ? 's' : ''} on this worker`
}

/** The worker's own progress (phase and denoising steps), with its time estimate when it has one. */
export function RunProgress({
  run,
  onCancel,
}: {
  run: VideoRun
  onCancel: () => void
}) {
  const status = run.status
  const started = status?.status === 'in_progress'
  const queued = status?.status === 'queued'
  const cancelling = run.cancelRequested || Boolean(status?.cancel_requested)
  const pct = started ? status.progress : null

  let label = 'Starting…'
  if (cancelling) label = 'Cancelling…'
  else if (started) label = `${phaseLabel(status)}…`
  else if (queued) label = 'Queued…'

  let hint = queued ? queueHint(status?.position) : 'Sending the request'
  if (started) {
    hint =
      status.phase === 'prepare'
        ? 'The first video at a new size or length compiles the model for it; later ones start at once'
        : status.estimated_time != null
          ? `About ${formatTime(status.estimated_time)} left`
          : 'No time estimate yet: this instance has not made a video of this size'
  }
  if (cancelling && started) hint = 'Stops before the next model call'

  return (
    <div className="space-y-1.5" data-testid="videogen-progress">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          role="status"
          className="text-foreground flex items-center gap-1.5 font-medium"
        >
          <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
          {label}
        </span>
        {started && (
          <span className="text-muted-foreground font-mono tabular-nums">
            {formatTime(status.elapsed_time)}
          </span>
        )}
      </div>
      <Progress
        value={pct}
        aria-label="Video progress"
        getValueLabel={(value) => `${value}%`}
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
          data-testid="videogen-cancel-button"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
    </div>
  )
}
