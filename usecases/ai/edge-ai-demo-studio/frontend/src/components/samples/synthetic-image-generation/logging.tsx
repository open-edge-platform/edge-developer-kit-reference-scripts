// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Terminal } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useLogs } from '@/hooks/use-logs'
import { LogEntry } from '@/types/log'

export function LogsDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const [logIndex, setLogIndex] = useState<{
    since: string | null
    offset: number | null
  }>({
    since: null,
    offset: null,
  })
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data } = useLogs(
    'synthetic-image-generation_custom',
    'custom',
    'synthetic-image-generation',
    logIndex.since ?? undefined,
    logIndex.offset ?? undefined,
    isOpen,
  )

  const [prevData, setPrevData] = useState<typeof data | null>(data)
  if (data !== prevData) {
    setPrevData(data)
    if (data?.logs && data.logs.length > 0) {
      setLogs((prev) => [...prev, ...data.logs].slice(-500))
      setLogIndex({ since: data.timestamp, offset: data.offset })
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setLogs([])
      setLogIndex({ since: null, offset: null })
      setPrevData(null)
    }
    setIsOpen(open)
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const errorCount = logs.filter((l) => l.type === 'error').length
  const infoCount = logs.filter((l) => l.type === 'out').length

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Terminal className="h-4 w-4" />
          Logs
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[80vh] w-[700px] flex-col p-6"
        align="end"
      >
        <div className="flex h-full flex-col gap-4 overflow-hidden">
          <div className="flex-none space-y-1">
            <h4 className="leading-none font-semibold">Service Console</h4>
            <p className="text-muted-foreground text-xs">
              Real-time logs for synthetic-image-generation service
            </p>
          </div>

          <div className="flex gap-4">
            <div className="rounded-lg border bg-red-50 px-3 py-1.5 dark:bg-red-950/20">
              <span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">
                {errorCount}
              </span>
              <span className="ml-1 text-xs text-red-600 uppercase dark:text-red-400">
                Errors
              </span>
            </div>
            <div className="rounded-lg border bg-blue-50 px-3 py-1.5 dark:bg-blue-950/20">
              <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                {infoCount}
              </span>
              <span className="ml-1 text-xs text-blue-600 uppercase dark:text-blue-400">
                Info
              </span>
            </div>
            <div className="rounded-lg border bg-slate-50 px-3 py-1.5 dark:bg-slate-800">
              <span className="font-mono text-sm font-bold text-slate-600 dark:text-slate-300">
                {logs.length}
              </span>
              <span className="ml-1 text-xs text-slate-600 uppercase dark:text-slate-400">
                Lines
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-black dark:border-slate-700">
            <div className="border-b border-slate-700 bg-slate-800 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="ml-2 text-xs text-slate-400">
                  synthetic-image-generation — console
                </span>
              </div>
            </div>
            <div
              ref={scrollRef}
              className="h-[400px] overflow-y-auto p-4 font-mono text-xs"
            >
              {logs.length === 0 ? (
                <div className="text-slate-500">
                  {isOpen
                    ? 'Waiting for service logs...'
                    : 'No service logs currently...'}
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div
                      key={`log_` + index}
                      className="flex items-start gap-2"
                    >
                      <span className="w-16 flex-shrink-0 text-slate-500 select-none">
                        {new Date(log.timestamp).toLocaleTimeString([], {
                          hour12: false,
                        })}
                      </span>
                      <span
                        className={`w-12 flex-shrink-0 font-bold ${
                          log.type === 'error'
                            ? 'text-red-400'
                            : log.type === 'out'
                              ? 'text-blue-400'
                              : 'text-slate-400'
                        }`}
                      >
                        [
                        {(log.type === 'out' ? 'Info' : log.type).toUpperCase()}
                        ]
                      </span>
                      <span className="flex-1 break-words text-slate-200">
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
