// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Loader,
  RotateCcw,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import { InfoTip } from '@/components/common/info-tip'
import { Button } from '@/components/ui/button'
import { formatCompactNumber, formatTimeOfDay } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { safeHref, HREF_CHARS } from '@/lib/validation'
import { metricsRegistry } from '@/services/_generated/metrics'
import type {
  MeasuredWork,
  MetricFigure,
} from '@/services/common/metrics/types'
import { resetWork, useInstanceWork } from '@/services/common/metrics/work'
import type { Service } from '@/services/types'
import { useLogsHref } from '../use-logs-href'

const PANEL_TIP =
  'How fast this instance did the latest request this demo sent from this browser tab, with the model time the worker reports where it does. Calls from samples, other services or your own code are not measured here.'

function headline(figures: MetricFigure[], work: MeasuredWork): string | null {
  for (const figure of figures) {
    const line = figure.headline?.(work)
    if (line) return line
  }
  return null
}

/**
 * Live performance of the latest request the demo sent, with the figures from the service's
 * `metrics.tsx` (no file, no panel). Until a request completes it is a single line.
 */
export function DemoMetricsPanel({
  service,
  onViewLogs,
}: {
  service: Service
  /** Switches the page to this instance's Logs tab. */
  onViewLogs?: () => void
}) {
  // Hidden services are not part of the UI.
  const figures = metricsRegistry[service.id]
  const apiBase = service.hidden || !figures ? undefined : service.apiBase
  const { lastWork: work, inFlight, calls, failed } = useInstanceWork(apiBase)
  const [open, setOpen] = useState(true)
  const logsHref = useLogsHref()

  if (!apiBase || !figures) return null

  let safeLogsHref = ''
  for (const ch of safeHref(logsHref)) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeLogsHref = '/'
      break
    }
    safeLogsHref += ok
  }

  const collapsedFigure = open || !work ? null : headline(figures, work)

  const failures = failed > 0 && (
    <p
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
      data-testid="metrics-failures"
    >
      <AlertTriangle
        aria-hidden="true"
        className="text-warning h-3.5 w-3.5 shrink-0"
      />
      <span>
        {failed} of {formatCompactNumber(calls)} requests failed
        {' · '}
        <a
          href={safeLogsHref}
          className="text-primary hover:underline"
          onClick={(e) => {
            // The page's own tab switch keeps the selected instance
            // and scroll position; the address works without it too.
            if (!onViewLogs) return
            e.preventDefault()
            onViewLogs()
          }}
        >
          details in Logs
        </a>
      </span>
    </p>
  )

  return (
    <section
      aria-label="Live metrics"
      data-testid="demo-metrics-panel"
      data-state={work ? 'measured' : 'empty'}
      className="border-border bg-muted/10 rounded-xl border"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
            <Activity aria-hidden="true" className="text-primary h-3.5 w-3.5" />
          </div>
          <h3 className="text-foreground text-sm font-medium">Live metrics</h3>
          <InfoTip
            ariaLabel="About live metrics"
            contentClassName="max-w-72"
            tooltip={PANEL_TIP}
          />
        </div>

        {collapsedFigure && (
          <span
            className="text-foreground text-xs font-semibold tabular-nums"
            data-testid="metrics-headline"
          >
            {collapsedFigure}
          </span>
        )}

        {inFlight > 0 && (
          <span
            role="status"
            className="text-primary flex items-center gap-1.5 text-xs font-medium"
            data-testid="metrics-in-flight"
          >
            <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            {inFlight} in progress
          </span>
        )}

        {!work && inFlight === 0 && (
          <span
            className="text-muted-foreground text-xs"
            data-testid="metrics-empty"
          >
            Figures appear after the first request completes.
          </span>
        )}

        <div className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
          {work && (
            <span className="hidden sm:inline">
              Latest request at{' '}
              {formatTimeOfDay(new Date(work.at).toISOString())}
            </span>
          )}
          {(work || calls > 0) && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Reset metrics"
              title="Clear these figures"
              onClick={() => resetWork(apiBase)}
            >
              <RotateCcw
                aria-hidden="true"
                className="text-muted-foreground h-3.5 w-3.5"
              />
            </Button>
          )}
          {work && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={
                open ? 'Collapse live metrics' : 'Expand live metrics'
              }
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'text-muted-foreground h-4 w-4 transition-transform duration-200',
                  open && 'rotate-180',
                )}
              />
            </Button>
          )}
        </div>
      </div>

      {work && open ? (
        <div className="border-border space-y-3 border-t px-4 py-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
            {figures.map((figure) => (
              <Fragment key={figure.id}>{figure.render(work)}</Fragment>
            ))}
          </div>
          {failures}
        </div>
      ) : (
        failures && (
          <div className="border-border border-t px-4 py-2">{failures}</div>
        )
      )}
    </section>
  )
}
