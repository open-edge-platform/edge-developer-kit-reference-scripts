// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
  CardContent,
} from '../ui/card'
import { Button } from '../ui/button'
import { useLogs } from '@/hooks/use-logs'
import { useEffect, useState, useRef } from 'react'
import { LogEntry } from '@/app/(frontend)/api/logs/route'

export default function Logs({ name }: { name: string }) {
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
    name,
    logIndex.since ?? undefined,
    logIndex.offset ?? undefined,
  )
  const MAX_LINES = 500

  useEffect(() => {
    if (data?.logs) {
      setLogs((prev) => {
        return [...prev, ...data.logs].slice(-MAX_LINES)
      })

      setLogIndex({ since: data.timestamp, offset: data.offset })
    }
  }, [data])

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
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
          <Button variant="outline" size="sm">
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Console Window */}
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

            <div
              ref={scrollRef}
              className="text-input h-96 overflow-y-auto bg-black p-4 font-mono text-sm"
            >
              {logs.length === 0 ? (
                <div className="text-slate-500">
                  <div>Waiting for service logs...</div>
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div
                      key={`log_` + index}
                      className="flex items-start gap-2"
                    >
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
                        [
                        {(log.type === 'out' ? 'Info' : log.type).toUpperCase()}
                        ]
                      </span>
                      <span className="flex-1 break-words">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Console Stats */}
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="rounded-lg border bg-red-50 p-3">
              <div className="font-mono text-lg font-bold text-red-600">
                {logs.filter((log) => log.type === 'error').length}
              </div>
              <div className="text-xs tracking-wide text-red-600 uppercase">
                Errors
              </div>
            </div>
            <div className="rounded-lg border bg-blue-50 p-3">
              <div className="font-mono text-lg font-bold text-blue-600">
                {logs.filter((log) => log.type === 'out').length}
              </div>
              <div className="text-xs tracking-wide text-blue-600 uppercase">
                Info
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
