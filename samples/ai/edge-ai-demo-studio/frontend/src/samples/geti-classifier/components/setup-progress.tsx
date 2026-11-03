// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CheckCircle2, Circle, Loader } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { SetupJob, SetupStage } from '../lib/api'

/** The stages a deploy shows, in the order the worker goes through them. */
const STAGES: { stage: SetupStage; label: string }[] = [
  { stage: 'connecting', label: 'Connecting to Geti' },
  { stage: 'preparing', label: 'Preparing deployment package' },
  { stage: 'downloading', label: 'Downloading' },
  { stage: 'extracting', label: 'Extracting' },
  { stage: 'compiling', label: 'Compiling on device' },
]

const STAGE_ORDER: SetupStage[] = [
  'queued',
  ...STAGES.map(({ stage }) => stage),
  'done',
]

/** "12.3 MB of 40.0 MB" (or just "12.3 MB" without a known size). */
function downloadedLabel(job: SetupJob): string | null {
  if (job.bytes_downloaded == null) return null
  const done = formatBytes(job.bytes_downloaded)
  return job.bytes_total ? `${done} of ${formatBytes(job.bytes_total)}` : done
}

/** Short label for the deploy button while a setup runs. */
export function setupStageLabel(job: SetupJob | null): string {
  if (!job) return 'Starting setup...'
  switch (job.stage) {
    case 'queued':
      return 'Waiting to start...'
    case 'connecting':
      return 'Connecting to Geti...'
    case 'preparing':
      return 'Preparing package...'
    case 'downloading': {
      const total = job.bytes_total
      const done = job.bytes_downloaded
      return total && done != null
        ? `Downloading ${Math.floor((done / total) * 100)}%...`
        : 'Downloading deployment...'
    }
    case 'extracting':
      return 'Extracting...'
    case 'compiling':
      return 'Compiling on device...'
    default:
      return 'Starting setup...'
  }
}

/** Stage-by-stage view of a running setup job. */
export function SetupProgress({ job }: { job: SetupJob | null }) {
  const current = STAGE_ORDER.indexOf(job?.stage ?? 'queued')
  const downloaded = job ? downloadedLabel(job) : null
  const percent =
    job?.bytes_total && job.bytes_downloaded != null
      ? Math.min(100, (job.bytes_downloaded / job.bytes_total) * 100)
      : null

  return (
    <div
      data-testid="setup-progress"
      role="status"
      className="bg-muted/20 space-y-2 rounded-xl border p-4"
    >
      <ol className="space-y-2">
        {STAGES.map(({ stage, label }) => {
          const index = STAGE_ORDER.indexOf(stage)
          const isDone = index < current
          const isActive = index === current
          return (
            <li
              key={stage}
              aria-current={isActive ? 'step' : undefined}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2 text-sm">
                {isDone ? (
                  <CheckCircle2
                    className="text-success h-4 w-4 flex-shrink-0"
                    aria-hidden
                  />
                ) : isActive ? (
                  <Loader
                    className="text-primary h-4 w-4 flex-shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className="text-muted-foreground/50 h-4 w-4 flex-shrink-0"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    isActive ? 'font-medium' : 'text-muted-foreground',
                  )}
                >
                  {label}
                  {isDone && <span className="sr-only"> (done)</span>}
                </span>
                {isActive && stage === 'downloading' && downloaded && (
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {downloaded}
                  </span>
                )}
              </div>
              {isActive && stage === 'downloading' && percent !== null && (
                <Progress
                  value={percent}
                  aria-label="Download progress"
                  className="ml-6 h-1.5 w-auto"
                />
              )}
            </li>
          )
        })}
      </ol>
      {job?.message && (
        <p className="text-muted-foreground text-xs">{job.message}</p>
      )}
    </div>
  )
}
