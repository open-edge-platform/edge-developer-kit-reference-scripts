// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AudioLines } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useTimeSince } from '@/hooks/use-time-since'
import { formatTimeAgo, plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { DetectionEvent } from '../lib/detection-stream'
import { wakeWordLabel } from '../lib/model-names'

/** When it was, kept current: `3 min ago`. */
function TimeAgo({ timestamp }: { timestamp: string }) {
  const then = new Date(timestamp).getTime()
  const elapsed = useTimeSince(then)
  return <>{formatTimeAgo(then, then + elapsed)}</>
}

/** A loaded wake word's detections: count, average and best score, and when the last one was. */
export function ModelEventCard({
  model,
  events,
  isTriggered,
}: {
  model: string
  /** Newest first. */
  events: DetectionEvent[]
  /** Just detected. */
  isTriggered: boolean
}) {
  const count = events.length
  const hasEvents = count > 0
  const avgPct = hasEvents
    ? Math.round((events.reduce((s, e) => s + e.score, 0) / count) * 100)
    : 0
  const bestPct = hasEvents
    ? Math.round(Math.max(...events.map((e) => e.score)) * 100)
    : 0
  const label = wakeWordLabel(model)

  return (
    <div
      className={cn(
        'border-border bg-background rounded-lg border p-3 transition-colors',
        isTriggered && 'border-success/50 bg-success/5',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              hasEvents
                ? 'bg-success/10 text-success'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <AudioLines aria-hidden className="h-3.5 w-3.5" />
          </div>
          <span className="text-foreground text-sm font-medium">{label}</span>
          {isTriggered && (
            <>
              <span
                aria-hidden="true"
                className="bg-success inline-block h-2 w-2 animate-pulse rounded-full"
              />
              <span className="sr-only">Just detected</span>
            </>
          )}
        </div>
        <Badge
          variant={hasEvents ? 'secondary' : 'outline'}
          className="text-xs"
        >
          {plural(count, 'event')}
        </Badge>
      </div>
      {hasEvents ? (
        <>
          <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
            <span>Avg {avgPct}%</span>
            <span aria-hidden="true" className="text-border">
              ·
            </span>
            <span>Best {bestPct}%</span>
            <span aria-hidden="true" className="text-border">
              ·
            </span>
            <span>
              <TimeAgo timestamp={events[0].timestamp} />
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Progress
              value={avgPct}
              aria-label={`${label} average score`}
              className="h-1.5 flex-1"
              indicatorClassName={
                avgPct > 80
                  ? 'bg-success'
                  : avgPct > 60
                    ? 'bg-primary'
                    : 'bg-muted-foreground/40'
              }
            />
            <span className="text-muted-foreground w-9 text-right text-xs">
              {avgPct}%
            </span>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground mt-1.5 text-xs">
          No detections yet
        </p>
      )}
    </div>
  )
}
