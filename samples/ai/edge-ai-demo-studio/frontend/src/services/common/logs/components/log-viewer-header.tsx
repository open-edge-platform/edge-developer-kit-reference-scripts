// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Terminal } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import type { LogFilters, LogRun } from '../hooks/use-log'
import { LogToolbar } from './log-controls'

/** The log viewer's title (instance, service and run) and its toolbar. */
export function LogViewerHeader({
  label,
  serviceName,
  filters,
  run,
  onRunChange,
  onRefresh,
  refreshing,
  onDownload,
  shownCount,
}: {
  /** The instance's label. */
  label: string
  serviceName: string
  filters: LogFilters
  run: LogRun
  onRunChange: (run: LogRun) => void
  onRefresh: () => void
  refreshing: boolean
  onDownload: () => void
  shownCount: number
}) {
  const runLabel = run === 'previous' ? 'Previous run' : 'Current run'
  return (
    <div className="border-border bg-muted/30 space-y-3 border-b p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Terminal aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3
            className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold"
            data-testid="log-title"
          >
            <span className="shrink-0">Runtime logs</span>
            <span aria-hidden className="text-muted-foreground shrink-0">
              ·
            </span>
            <TruncatedText text={label} className="min-w-0" />
          </h3>
          <p className="text-muted-foreground text-xs">
            {label === serviceName ? runLabel : `${serviceName} · ${runLabel}`}
          </p>
        </div>
      </div>
      <LogToolbar
        filters={filters}
        run={run}
        onRunChange={onRunChange}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onDownload={onDownload}
        shownCount={shownCount}
      />
    </div>
  )
}
