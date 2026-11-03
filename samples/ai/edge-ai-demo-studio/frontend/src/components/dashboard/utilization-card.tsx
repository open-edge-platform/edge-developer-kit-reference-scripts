// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import { CircleSlash } from 'lucide-react'
import { useId } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { MONITORING_POLL_INTERVAL_MS } from '@/lib/monitoring-interval'
import { cn } from '@/lib/utils'

const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString([], { hour12: true }).toLowerCase()

/** Span of a history ending at `updatedAt`, one poll interval per step; `null` without a timestamp. */
function historySpan(
  pointCount: number,
  updatedAt: string | undefined,
): { start: number; end: number } | null {
  const end = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (Number.isNaN(end)) return null
  const steps = Math.max(pointCount - 1, 0)
  return { start: end - steps * MONITORING_POLL_INTERVAL_MS, end }
}

function TrendGraph({
  points,
  colorClass,
}: {
  points: number[]
  colorClass: string
}) {
  if (points.length < 2) {
    return (
      <div aria-hidden="true" className="bg-muted/30 h-18 w-full rounded-lg" />
    )
  }

  const width = 200
  const height = 40
  const step = width / Math.max(points.length - 1, 1)
  const linePoints = points
    .map((value, index) => {
      const x = index * step
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height
      return `${x},${y}`
    })
    .join(' ')
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`

  return (
    // Stretched to the card's width (the stroke keeps its width), so the
    // trend spans the same time axis as the times printed under it.
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-18 w-full', colorClass)}
    >
      <polygon points={areaPoints} className="fill-current opacity-10" />
      <polyline
        points={linePoints}
        fill="none"
        className="stroke-current"
        vectorEffect="non-scaling-stroke"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One usage figure with its recent trend. A missing reading shows as Unavailable with the reason,
 * never as 0%, which would read as an idle device.
 */
export function UtilizationCard({
  label,
  value,
  detail,
  unavailableReason,
  icon: Icon,
  colorClass,
  history,
  updatedAt,
  'data-testid': testId,
}: {
  label: string
  /** Percent used; `null` when it could not be read. */
  value: number | null
  /** Under the figure, e.g. used and total memory with units. */
  detail?: string
  /** Why `value` is missing, shown in its place. */
  unavailableReason?: string
  icon: LucideIcon
  colorClass: string
  history?: number[]
  updatedAt?: string
  'data-testid'?: string
}) {
  const reasonId = useId()
  const trend = history ?? []
  const span = historySpan(trend.length, updatedAt)
  const unavailable = value === null

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={unavailable ? reasonId : undefined}
      data-testid={testId}
      data-state={unavailable ? 'unavailable' : 'available'}
      // A column, the trend pinned to the bottom: cards side by side line
      // up their trends whether or not each has a detail line.
      className="glass-card flex min-w-0 flex-col rounded-xl p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden="true"
            className={cn(
              'h-4 w-4 shrink-0',
              unavailable ? 'text-muted-foreground' : colorClass,
            )}
          />
          <TruncatedText
            text={label}
            className="text-sm font-medium"
            data-testid="metric-label"
          />
        </div>
        <div className="shrink-0 text-right">
          {unavailable ? (
            <span
              data-testid="metric-value"
              className="text-muted-foreground flex items-center gap-1 text-sm font-medium"
            >
              <CircleSlash aria-hidden="true" className="h-3.5 w-3.5" />
              Unavailable
            </span>
          ) : (
            <span
              data-testid="metric-value"
              className={cn('text-lg font-semibold', colorClass)}
            >
              {Math.round(value)}%
            </span>
          )}
        </div>
      </div>

      {unavailable ? (
        <p
          id={reasonId}
          data-testid="metric-unavailable-reason"
          className="border-border text-muted-foreground flex min-h-18 items-center rounded-lg border border-dashed px-3 py-2 text-xs"
        >
          {unavailableReason ?? 'This reading could not be taken.'}
        </p>
      ) : (
        <>
          {detail && (
            <p
              data-testid="metric-detail"
              className="text-muted-foreground -mt-2 mb-3 text-xs"
            >
              {detail}
            </p>
          )}
          <div className="mt-auto">
            <TrendGraph points={trend} colorClass={colorClass} />
            {span && (
              <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                <time dateTime={new Date(span.start).toISOString()}>
                  {formatTime(span.start)}
                </time>
                <time dateTime={new Date(span.end).toISOString()}>
                  {formatTime(span.end)}
                </time>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
