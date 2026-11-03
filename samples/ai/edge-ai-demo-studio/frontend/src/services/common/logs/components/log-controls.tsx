// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  ArrowDownToLine,
  Download,
  EyeOff,
  RefreshCw,
  Search,
  WrapText,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { statusDotClass } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatTimeAgo } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { ServiceStatus } from '@/services/types'
import type { LevelFilter, LogFilters, LogRun } from '../hooks/use-log'
import { formatLogTime } from '../log-message'

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ERROR', label: 'Error' },
  { value: 'WARN', label: 'Warn' },
  { value: 'INFO', label: 'Info' },
  { value: 'DEBUG', label: 'Debug' },
]

const RUN_LABEL: Record<LogRun, string> = {
  current: 'Current',
  previous: 'Previous',
}

const TRIGGER_CLASS = 'h-8 gap-1.5 px-2.5 text-xs'

/** Search, level, run and source pickers above a log view, with Refresh and Download. */
export function LogToolbar({
  filters,
  run,
  onRunChange,
  onRefresh,
  refreshing,
  onDownload,
  shownCount,
}: {
  filters: LogFilters
  run: LogRun
  onRunChange: (run: LogRun) => void
  onRefresh: () => void
  refreshing: boolean
  onDownload: () => void
  /** Entries the filters let through: what Download saves. */
  shownCount: number
}) {
  const { search, level, counts, source, sourceOptions } = filters
  // Levels with nothing to show stay out of the way, unless selected.
  const levels = LEVEL_OPTIONS.filter(
    (o) => o.value === 'ALL' || o.value === level || counts[o.value] > 0,
  )
  const sourceLabel =
    sourceOptions.find((s) => s.key === source)?.label ?? 'All'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-48">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label="Search logs"
          placeholder="Search logs…"
          value={search}
          onChange={(e) => filters.setSearch(e.target.value)}
          className="h-8 pl-8 text-xs md:text-xs"
        />
      </div>

      <Select
        value={level}
        onValueChange={(v) => filters.setLevel(v as LevelFilter)}
      >
        <SelectTrigger aria-label="Level" className={TRIGGER_CLASS}>
          <span className="text-muted-foreground">Level:</span>
          <SelectValue>
            {LEVEL_OPTIONS.find((o) => o.value === level)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {levels.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              <span className="flex min-w-28 items-center justify-between gap-4">
                {o.label}{' '}
                <span className="text-muted-foreground tabular-nums">
                  {counts[o.value]}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={run} onValueChange={(v) => onRunChange(v as LogRun)}>
        <SelectTrigger aria-label="Run" className={TRIGGER_CLASS}>
          <span className="text-muted-foreground">Run:</span>
          <SelectValue>{RUN_LABEL[run]}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="current" className="text-xs">
            Current
          </SelectItem>
          <SelectItem value="previous" className="text-xs">
            Previous
          </SelectItem>
        </SelectContent>
      </Select>

      {sourceOptions.length > 1 && (
        <Select value={source} onValueChange={filters.setSource}>
          <SelectTrigger aria-label="Source" className={TRIGGER_CLASS}>
            <span className="text-muted-foreground">Source:</span>
            <SelectValue>{sourceLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="ALL" className="text-xs">
              All
            </SelectItem>
            {sourceOptions.map((s) => (
              <SelectItem key={s.key} value={s.key} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={onRefresh}
        aria-busy={refreshing}
      >
        <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        Refresh
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={onDownload}
        disabled={shownCount === 0}
        title={
          shownCount === 0
            ? 'No entries to download'
            : `Save the ${shownCount} ${shownCount === 1 ? 'entry' : 'entries'} shown as a text file`
        }
        data-testid="log-download"
      >
        <Download aria-hidden className="size-3.5" />
        Download
      </Button>
    </div>
  )
}

/** "Updated 12s ago", ticking while shown. */
function UpdatedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(at)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>Updated {formatTimeAgo(at, Math.max(now, at))}</span>
}

function stateLabel(run: LogRun, status: ServiceStatus) {
  if (run === 'previous') return 'Previous run'
  switch (status) {
    case 'online':
      return 'Receiving updates'
    case 'starting':
      return 'Starting'
    case 'error':
      return 'Failed to start'
    default:
      return 'Stopped'
  }
}

/** What a log view shows and how fresh it is (`LogStatusLine`). */
export interface LogSummary {
  serviceStatus: ServiceStatus
  run: LogRun
  lastUpdatedAt: number | null
  /** Every source failed on the latest read. */
  refreshFailed: boolean
  shown: number
  retained: number
  maxEntries: number
  filtered: boolean
}

/** The reader's display toggles (`LogStatusLine`). */
export interface LogViewToggles {
  wrap: boolean
  onToggleWrap: () => void
  following: boolean
  onToggleFollow: () => void
  /** The health checks and log reads the toggle hides; no toggle when empty. */
  pollingPaths: string[]
  hidePolling: boolean
  onTogglePolling: () => void
}

/** The state line under a log view, with its display toggles. */
export function LogStatusLine({
  summary,
  view,
  onRetry,
}: {
  summary: LogSummary
  view: LogViewToggles
  onRetry?: () => void
}) {
  const {
    serviceStatus,
    run,
    lastUpdatedAt,
    refreshFailed,
    shown,
    retained,
    maxEntries,
    filtered,
  } = summary
  const {
    wrap,
    onToggleWrap,
    following,
    onToggleFollow,
    pollingPaths,
    hidePolling,
    onTogglePolling,
  } = view
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5" data-testid="log-state">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            run === 'previous'
              ? 'bg-muted-foreground/40'
              : statusDotClass(serviceStatus),
          )}
        />
        {stateLabel(run, serviceStatus)}
      </span>
      {refreshFailed ? (
        <>
          <span aria-hidden>·</span>
          <span
            className="text-destructive flex items-center gap-1"
            data-testid="log-refresh-failed"
          >
            <AlertTriangle aria-hidden className="size-3" />
            {lastUpdatedAt !== null && retained > 0
              ? `Refresh failed · showing entries from ${formatLogTime(lastUpdatedAt)}`
              : 'Refresh failed'}
          </span>
          {onRetry && (
            <Button
              variant="ghost"
              size="xs"
              className="text-xs"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </>
      ) : (
        lastUpdatedAt !== null && (
          <>
            <span aria-hidden>·</span>
            <UpdatedAgo at={lastUpdatedAt} />
          </>
        )
      )}
      <span aria-hidden>·</span>
      <span data-testid="log-retained">
        {filtered ? `${shown} of ${retained}` : retained}{' '}
        {retained === 1 ? 'entry' : 'entries'} · latest {maxEntries} retained in
        this view
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-1">
        {pollingPaths.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'text-xs',
              hidePolling && 'bg-primary/10 text-primary',
            )}
            aria-pressed={hidePolling}
            onClick={onTogglePolling}
            title={`Hide successful GET ${pollingPaths.join(', ')}`}
          >
            <EyeOff aria-hidden />
            Hide polling
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-xs', wrap && 'bg-primary/10 text-primary')}
          aria-pressed={wrap}
          onClick={onToggleWrap}
        >
          <WrapText aria-hidden />
          Wrap lines
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-xs', following && 'bg-primary/10 text-primary')}
          aria-pressed={following}
          onClick={onToggleFollow}
        >
          <ArrowDownToLine aria-hidden />
          Follow
        </Button>
      </span>
    </div>
  )
}
