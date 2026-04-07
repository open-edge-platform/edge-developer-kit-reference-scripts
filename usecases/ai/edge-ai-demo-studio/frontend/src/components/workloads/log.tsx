// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText, RefreshCw } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
  CardContent,
} from '../ui/card'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { useLogs } from '@/hooks/use-logs'
import { useOldLogs } from '@/hooks/use-logs'
import { useEffect, useState, useRef, type RefObject } from 'react'
import { LogEntry } from '@/types/log'
import { Workload } from '@/payload-types'

export default function Logs({
  engine,
  type,
  status,
}: {
  engine: Workload['engine']
  type: Workload['type']
  status?: Workload['status']
}) {
  const MAX_LINES = 200

  const processName = `${type}_${engine}`
  const { data, refetch } = useLogs(processName, engine, type)

  const logs = (data?.logs ?? []).slice(-MAX_LINES)

  const [activeTab, setActiveTab] = useState<'current' | 'previous'>('current')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const oldScrollRef = useRef<HTMLDivElement | null>(null)
  const isAtBottom = useRef(true)
  const oldIsAtBottom = useRef(true)

  const BOTTOM_THRESHOLD = 48

  const {
    data: oldData,
    isFetching: oldFetching,
    refetch: refetchOld,
  } = useOldLogs(processName, activeTab === 'previous')

  useEffect(() => {
    if (status === undefined) return
    refetch()
    refetchOld()
  }, [status, refetch, refetchOld])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      isAtBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = oldScrollRef.current
    if (!el) return
    const onScroll = () => {
      oldIsAtBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll current logs only when pinned to bottom
  useEffect(() => {
    if (isAtBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  // Auto-scroll old logs to bottom when they first load (if pinned)
  useEffect(() => {
    if (
      oldIsAtBottom.current &&
      oldScrollRef.current &&
      oldData?.logs?.length
    ) {
      oldScrollRef.current.scrollTop = oldScrollRef.current.scrollHeight
    }
  }, [oldData])

  const oldLogs = oldData?.logs ?? []

  const renderLogLines = (
    lines: LogEntry[],
    ref: RefObject<HTMLDivElement | null>,
    emptyMessage: string,
  ) => (
    <div
      ref={ref}
      className="text-input h-96 overflow-y-auto bg-black p-4 font-mono text-sm"
    >
      {lines.length === 0 ? (
        <div className="text-slate-500">
          <div>{emptyMessage}</div>
        </div>
      ) : (
        <div className="space-y-1">
          {lines.map((log, index) => (
            <div key={`log_` + index} className="flex items-start gap-2">
              <span className="w-16 flex-shrink-0 text-xs text-slate-500 select-none">
                {new Date(log.timestamp).toLocaleTimeString([], {
                  hour12: false,
                })}
              </span>
              <span
                className={`w-12 flex-shrink-0 text-xs font-bold ${
                  log.type === 'error'
                    ? 'text-red-400'
                    : log.type === 'out'
                      ? 'text-blue-400'
                      : 'text-slate-400'
                }`}
              >
                [{(log.type === 'out' ? 'Info' : log.type).toUpperCase()}]
              </span>
              <span className="flex-1 break-words">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderStats = (lines: LogEntry[]) => (
    <div className="grid grid-cols-2 gap-4 text-center">
      <div className="rounded-lg border bg-red-50 p-3">
        <div className="font-mono text-lg font-bold text-red-600">
          {lines.filter((log) => log.type === 'error').length}
        </div>
        <div className="text-xs tracking-wide text-red-600 uppercase">
          Errors
        </div>
      </div>
      <div className="rounded-lg border bg-blue-50 p-3">
        <div className="font-mono text-lg font-bold text-blue-600">
          {lines.filter((log) => log.type === 'out').length}
        </div>
        <div className="text-xs tracking-wide text-blue-600 uppercase">
          Info
        </div>
      </div>
    </div>
  )

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as 'current' | 'previous')}
    >
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Service Console
              </CardTitle>
              <CardDescription>Real-time console output log</CardDescription>
            </div>
            <div>
              <TabsList className="mb-4">
                <TabsTrigger value="current">Current</TabsTrigger>
                <TabsTrigger value="previous">Previous</TabsTrigger>
              </TabsList>
              <Button variant="outline" size="sm" disabled>
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TabsContent value="current">
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-black">
                <div className="border-b border-slate-300 bg-slate-200 px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      Console Output
                    </span>
                    <div className="flex items-center gap-2 text-right text-xs text-slate-600">
                      <span>Lines: {logs.length}</span>
                    </div>
                  </div>
                </div>
                {renderLogLines(
                  logs,
                  scrollRef,
                  'No service logs currently...',
                )}
              </div>
              {renderStats(logs)}
            </div>
          </TabsContent>

          <TabsContent value="previous">
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-black">
                <div className="border-b border-slate-300 bg-slate-200 px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      Previous Run Logs
                    </span>
                    <div className="flex items-center gap-2 text-right text-xs text-slate-600">
                      <span>Lines: {oldLogs.length}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => refetchOld()}
                        disabled={oldFetching}
                        title="Refresh previous logs"
                        aria-label="Refresh previous logs"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${oldFetching ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                      </Button>
                    </div>
                  </div>
                </div>
                {renderLogLines(
                  oldLogs,
                  oldScrollRef,
                  'No previous logs found. Previous run logs appear here after a new process is started.',
                )}
              </div>
              {renderStats(oldLogs)}
            </div>
          </TabsContent>
        </CardContent>
      </Card>
    </Tabs>
  )
}
