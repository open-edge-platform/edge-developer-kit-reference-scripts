// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLog } from '@/services/common/logs/hooks/use-log'
import type { LogSource, Service } from '@/services/types'
import { LogControls, LogStatusBar, levelColor } from './log-controls'

function formatLogTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp

  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')

  return `${hh}:${mm}:${ss}`
}

export function ServiceLogs({
  service,
  logSources,
}: {
  service: Service
  logSources: LogSource[]
}) {
  const {
    logs,
    counts,
    filter,
    setFilter,
    logSession,
    setLogSession,
    refetch,
  } = useLog({
    sources: logSources,
    serviceName: service.id,
    isOnline: service.status === 'online',
    serviceStatus: service.status,
  })
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new log entries
  useEffect(() => {
    if (!autoScroll || !containerRef.current || logs.length === 0) return
    containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [autoScroll, logs.length])

  // Also scroll when the container becomes visible (force-mounted hidden tabs)
  useEffect(() => {
    const el = containerRef.current
    if (!autoScroll || !el) return
    const observer = new ResizeObserver(() => {
      if (el.offsetHeight > 0) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [autoScroll])

  return (
    <div className="space-y-4">
      <LogControls
        filter={filter}
        setFilter={setFilter}
        counts={counts}
        logSession={logSession}
        setLogSession={setLogSession}
        onRefetch={() => refetch()}
        autoScroll={autoScroll}
        onToggleAutoScroll={() => setAutoScroll((v) => !v)}
      />

      <LogStatusBar
        serviceStatus={service.status}
        logCount={logs.length}
        logSources={logSources}
        logSession={logSession}
      />

      {/* Log output */}
      <div
        ref={containerRef}
        className="border-border bg-muted/40 h-[500px] overflow-auto rounded-xl border p-4 font-mono text-xs leading-6 dark:bg-[#050810]"
      >
        {logs.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            No log entries yet...
          </div>
        ) : (
          logs.map((log, i) => (
            <div
              key={`${log.timestamp}-${i}`}
              className="hover:bg-muted/30 grid grid-cols-[12ch_6ch_1fr_auto] items-start gap-3 rounded px-1"
            >
              <span className="text-muted-foreground/60 shrink-0 tabular-nums select-none">
                {formatLogTime(log.timestamp)}
              </span>
              <span
                className={cn(
                  'w-12 shrink-0 text-right font-semibold tabular-nums',
                  levelColor[log.level],
                )}
              >
                {log.level}
              </span>
              <span className="text-muted-foreground min-w-0 break-words">
                {log.message}
              </span>
              {logSources.length > 1 && (
                <span className="text-muted-foreground/40 w-[22ch] shrink-0 truncate text-right">
                  [{log.source}]
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
