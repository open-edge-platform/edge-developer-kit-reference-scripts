// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, FileText, type LucideIcon, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { LogRun, SourceProblem } from '../hooks/use-log'

const SKELETON_WIDTHS = ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/5', 'w-2/3', 'w-1/3']

function BodyMessage({
  icon: Icon,
  title,
  tone = 'muted',
  children,
}: {
  icon: LucideIcon
  title: string
  tone?: 'muted' | 'destructive'
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-6 text-center font-sans">
      <Icon
        aria-hidden
        className={cn(
          'size-5',
          tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        )}
      />
      <p className="text-foreground text-sm font-medium">{title}</p>
      {children}
    </div>
  )
}

/** What the log area shows instead of lines: loading, read failure, nothing yet, or no filter match. */
export function LogBodyState({
  body,
  run,
  failedSources,
  showPollingHint,
  onRetry,
  onShowPolling,
  onClearFilters,
}: {
  body: 'loading' | 'failed' | 'empty' | 'no-match' | 'entries'
  run: LogRun
  failedSources: SourceProblem[]
  /** Health checks and log reads are hidden and there are some to show. */
  showPollingHint: boolean
  onRetry: () => void
  onShowPolling: () => void
  onClearFilters: () => void
}) {
  switch (body) {
    case 'loading':
      return (
        <div
          aria-hidden
          className="space-y-3 px-2 py-1"
          data-testid="log-skeleton"
        >
          {SKELETON_WIDTHS.map((width, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-[8ch] shrink-0" />
              <Skeleton className="h-3 w-[5ch] shrink-0" />
              <Skeleton className={cn('h-3', width)} />
            </div>
          ))}
        </div>
      )
    case 'failed':
      return (
        <BodyMessage
          icon={AlertTriangle}
          tone="destructive"
          title="Logs could not be loaded"
        >
          <p className="text-muted-foreground max-w-md text-xs break-words">
            {failedSources.map((s) => s.message).join('; ')}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </BodyMessage>
      )
    case 'empty':
      return (
        <BodyMessage
          icon={FileText}
          title={run === 'previous' ? 'No previous run logs' : 'No logs yet'}
        >
          {showPollingHint && (
            <>
              <p className="text-muted-foreground text-xs">
                Health checks and log reads are hidden.
              </p>
              <Button variant="outline" size="sm" onClick={onShowPolling}>
                Show polling
              </Button>
            </>
          )}
        </BodyMessage>
      )
    case 'no-match':
      return (
        <BodyMessage icon={SearchX} title="No matching entries">
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        </BodyMessage>
      )
    default:
      return null
  }
}
