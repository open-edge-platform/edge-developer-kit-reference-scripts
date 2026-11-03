// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { Virtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadBlob } from '@/lib/browser/download'
import { cn } from '@/lib/utils'
import type { Service } from '@/services/types'
import { type LogFilterAddress, useLog } from '../hooks/use-log'
import { useLogFollow } from '../hooks/use-log-follow'
import { formatLogExport, logExportFileName } from '../log-export'
import { getPollingPaths } from '../polling-paths'
import { LogBodyState } from './log-body-state'
import { LogStatusLine } from './log-controls'
import { LogRows } from './log-rows'
import { LogSourceNotices } from './log-source-notices'
import { LogSummary } from './log-summary'
import { LogViewerHeader } from './log-viewer-header'

/**
 * Runtime log viewer of one instance: all its log sources, polled while shown, with search and
 * filters, following the newest line until the reader scrolls away.
 */
export function ServiceLogs({
  service,
  compact = false,
  filterAddress,
}: {
  service: Service
  compact?: boolean
  /** Keep the level and source filters in the page address. */
  filterAddress?: LogFilterAddress
}) {
  const logSources = service.logSources
  // A hidden tab (display:none) reports no size; polling pauses until it shows again.
  const [visible, setVisible] = useState(true)
  const pollingPaths = getPollingPaths(service, logSources)
  const { feed, entries, filters, run, setRun, hidePolling, setHidePolling } =
    useLog({
      sources: logSources,
      // Instance key (`type@id`) — API log sources are fetched through
      // `/api/<key>`, so every instance reads its own worker logs.
      serviceName: service.instanceKey ?? service.id,
      serviceStatus: service.status,
      active: visible,
      pollingPaths,
      filterAddress,
    })
  const { refetch } = feed
  const [wrap, setWrap] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<Virtualizer<
    HTMLDivElement,
    HTMLDivElement
  > | null>(null)
  const { following, newCount, follow, pause, onScroll } = useLogFollow({
    containerRef,
    contentRef,
    virtualizerRef,
    entries,
    newestId: feed.newestId,
    onVisibleChange: setVisible,
  })

  const body = feed.isLoading
    ? 'loading'
    : feed.retained.length === 0
      ? feed.totalFailure
        ? 'failed'
        : 'empty'
      : entries.length === 0
        ? 'no-match'
        : 'entries'

  const refresh = () => {
    setRefreshing(true)
    refetch().finally(() => setRefreshing(false))
  }

  // The view reads the tail again either way, like switching runs.
  const togglePolling = () => {
    setHidePolling((value) => !value)
    follow()
  }
  const showPolling = () => {
    setHidePolling(false)
    follow()
  }

  const showSource = logSources.length > 1
  const partialFailure = !feed.totalFailure && feed.failedSources.length > 0
  const label = service.label ?? service.name
  const instanceKey = service.instanceKey ?? service.id

  const download = () => {
    const text = formatLogExport(entries, {
      label,
      instanceKey,
      run,
      level: filters.level,
      source:
        filters.source === 'ALL'
          ? undefined
          : filters.sourceOptions.find((s) => s.key === filters.source)?.label,
      search: filters.search,
      retained: feed.retained.length,
      showSource,
    })
    downloadBlob(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
      logExportFileName(instanceKey, run),
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      <section
        className="border-border bg-card overflow-hidden rounded-xl border shadow-sm"
        aria-label="Service log viewer"
      >
        <LogViewerHeader
          label={label}
          serviceName={service.name}
          filters={filters}
          run={run}
          onRunChange={(next) => {
            setRun(next)
            follow()
          }}
          onRefresh={refresh}
          refreshing={refreshing}
          onDownload={download}
          shownCount={entries.length}
        />

        {!compact && body !== 'loading' && (
          <LogSummary
            service={service}
            retained={feed.retained}
            run={run}
            showingErrors={filters.level === 'ERROR'}
            onShowErrors={() => {
              filters.setLevel('ERROR')
              follow()
            }}
          />
        )}

        <LogSourceNotices
          unavailableSources={feed.unavailableSources}
          failedSources={feed.failedSources}
          partialFailure={partialFailure}
          onRetry={refresh}
        />

        <div className="relative">
          <div
            aria-hidden
            className={cn(
              'border-border bg-muted/20 text-muted-foreground hidden gap-x-4 border-b px-3 py-2 font-mono text-xs sm:grid',
              showSource
                ? 'grid-cols-[8ch_7ch_minmax(0,1fr)_16ch]'
                : 'grid-cols-[8ch_7ch_minmax(0,1fr)]',
            )}
          >
            <span>Time</span>
            <span>Level</span>
            <span>Message</span>
            {showSource && <span className="text-right">Source</span>}
          </div>
          <div
            ref={containerRef}
            role="log"
            // Lines arrive every few seconds: announce state changes only.
            aria-live="off"
            aria-label={`${label} logs`}
            aria-busy={body === 'loading'}
            tabIndex={0}
            onScroll={onScroll}
            className={cn(
              'bg-background/60 focus-visible:ring-ring/50 dark:bg-background relative overflow-auto font-mono text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset',
              compact
                ? 'h-[240px]'
                : 'h-[min(560px,calc(100dvh-16rem))] min-h-[320px]',
              // Anchoring would hold the old lines in place instead.
              following && '[overflow-anchor:none]',
            )}
          >
            <div
              ref={contentRef}
              className={cn('min-h-full', !wrap && 'w-max min-w-full')}
            >
              <LogBodyState
                body={body}
                run={run}
                failedSources={feed.failedSources}
                showPollingHint={hidePolling && pollingPaths.length > 0}
                onRetry={refresh}
                onShowPolling={showPolling}
                onClearFilters={filters.clear}
              />
              {body === 'entries' && (
                <LogRows
                  entries={entries}
                  showSource={showSource}
                  wrap={wrap}
                  following={following}
                  containerRef={containerRef}
                  virtualizerRef={virtualizerRef}
                />
              )}
            </div>
          </div>

          {!following && body === 'entries' && (
            <Button
              size="sm"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
              onClick={follow}
            >
              <ArrowDown aria-hidden />
              {newCount > 0
                ? `Jump to latest · ${newCount} new`
                : 'Jump to latest'}
            </Button>
          )}
        </div>
        <div className="border-border bg-muted/20 border-t px-3 py-2">
          <LogStatusLine
            summary={{
              serviceStatus: service.status,
              run,
              lastUpdatedAt: feed.lastUpdatedAt,
              refreshFailed: feed.totalFailure,
              shown: entries.length,
              retained: feed.retained.length,
              maxEntries: feed.maxEntries,
              filtered: filters.active,
            }}
            view={{
              wrap,
              onToggleWrap: () => setWrap((v) => !v),
              following,
              onToggleFollow: following ? pause : follow,
              pollingPaths,
              hidePolling,
              onTogglePolling: togglePolling,
            }}
            onRetry={feed.retained.length > 0 ? refresh : undefined}
          />
        </div>
      </section>

      <div aria-live="polite" className="sr-only">
        <p>
          {body === 'loading'
            ? ''
            : feed.totalFailure
              ? 'Refreshing logs failed'
              : 'Logs loaded'}
        </p>
        <p>
          {partialFailure
            ? `${feed.failedSources.map((s) => s.label).join(', ')} logs unavailable`
            : ''}
        </p>
        <p>{following ? '' : 'Following paused'}</p>
      </div>
    </div>
  )
}
