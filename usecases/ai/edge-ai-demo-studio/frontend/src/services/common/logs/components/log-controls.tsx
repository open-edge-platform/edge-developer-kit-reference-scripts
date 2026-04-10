// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowDownToLine, History, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { LogFilter } from '@/services/common/logs/hooks/use-log'
import type { LogLevel, LogSource } from '@/services/types'

const levelColor: Record<LogLevel, string> = {
  INFO: 'text-success',
  WARN: 'text-warning',
  ERROR: 'text-red-400',
  DEBUG: 'text-blue-400',
}

export { levelColor }

export function LogControls({
  filter,
  setFilter,
  counts,
  logSession,
  setLogSession,
  onRefetch,
  autoScroll,
  onToggleAutoScroll,
}: {
  filter: LogFilter
  setFilter: (f: LogFilter) => void
  counts: Record<LogFilter, number>
  logSession: 'current' | 'previous'
  setLogSession: (s: 'current' | 'previous') => void
  clear?: () => void
  onRefetch?: () => void
  autoScroll?: boolean
  onToggleAutoScroll?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {(['ALL', 'INFO', 'ERROR'] as const).map((level) => (
          <Button
            key={level}
            variant={filter === level ? 'default' : 'ghost'}
            size="sm"
            className={'h-7 gap-1.5 text-xs'}
            onClick={() => setFilter(level)}
          >
            {level}
            <span className="text-[10px]">{counts[level]}</span>
          </Button>
        ))}
        <span className="text-border">|</span>
        <Button
          variant={logSession === 'current' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setLogSession('current')}
        >
          <Radio className="h-3 w-3" />
          Current
        </Button>
        <Button
          variant={logSession === 'previous' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setLogSession('previous')}
        >
          <History className="h-3 w-3" />
          Previous
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {onToggleAutoScroll && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 text-xs',
              autoScroll ? 'text-blue-400' : 'text-muted-foreground',
            )}
            onClick={onToggleAutoScroll}
            aria-pressed={autoScroll}
          >
            <ArrowDownToLine className="h-3 w-3" />
            Auto-scroll
          </Button>
        )}
        {onRefetch && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onRefetch}
          >
            <RefreshCw className="h-3 w-3" />
            Refetch
          </Button>
        )}
      </div>
    </div>
  )
}

export function LogStatusBar({
  serviceStatus,
  logCount,
  logSources,
  logSession,
}: {
  serviceStatus: string
  logCount: number
  logSources: LogSource[]
  logSession: 'current' | 'previous'
}) {
  const isOnline = serviceStatus === 'online'
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            logSession === 'previous'
              ? 'bg-muted-foreground/40'
              : isOnline
                ? 'bg-status-online status-pulse'
                : 'bg-status-offline',
          )}
        />
        {logSession === 'previous'
          ? 'Viewing previous run'
          : isOnline
            ? 'Streaming logs'
            : 'Service offline'}
      </span>
      <span>·</span>
      <span>{logCount} entries</span>
      {logSources.length > 1 && (
        <>
          <span>·</span>
          <span>{logSources.length} sources</span>
        </>
      )}
    </div>
  )
}
