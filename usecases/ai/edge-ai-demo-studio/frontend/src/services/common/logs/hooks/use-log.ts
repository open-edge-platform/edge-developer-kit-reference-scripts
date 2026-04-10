// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogLevel, LogSource } from '@/services/types'
import type { ApiLogResponse } from '@/types/common'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  source: string
}

/** Map the `type` field from file-based logs to a LogLevel. */
function mapTypeToLevel(type: string): LogLevel {
  if (type === 'error') return 'ERROR'
  if (type === 'info') return 'INFO'
  return 'INFO' // "out" and anything else → INFO
}

/** Map the `level` string from multiserve API logs to a LogLevel. */
function mapApiLevel(level: string | undefined): LogLevel {
  if (!level) return 'INFO'
  const upper = level.toUpperCase()
  if (upper === 'ERROR' || upper === 'ERR') return 'ERROR'
  return 'INFO'
}

export type LogFilter = 'ALL' | 'INFO' | 'ERROR'

// ─── Pagination state per source ──────────────────────────────────
interface PaginationState {
  offset: number
  timestamp: string | null
}

interface UseLogOptions {
  sources: LogSource[]
  serviceName: string
  isOnline: boolean
  serviceStatus?: string
  maxEntries?: number
}

const POLL_INTERVAL = 3_000

export function useLog({
  sources,
  serviceName,
  serviceStatus,
  maxEntries = 500,
}: UseLogOptions) {
  const [isPaused, setIsPaused] = useState(false)
  const [filter, setFilter] = useState<LogFilter>('ALL')
  const [logSession, setLogSession] = useState<'current' | 'previous'>(
    'current',
  )
  const [clearCounter, setClearCounter] = useState(0)
  const logSessionRef = useRef<'current' | 'previous'>('current')
  useEffect(() => {
    logSessionRef.current = logSession
  }, [logSession])

  const serviceStatusRef = useRef(serviceStatus)
  useEffect(() => {
    serviceStatusRef.current = serviceStatus
  }, [serviceStatus])

  const paginationRef = useRef<Map<string, PaginationState>>(new Map())
  const accumulatedRef = useRef<LogEntry[]>([])
  const accumulatedKeyRef = useRef('')

  const sourceKey = useCallback(
    (src: LogSource) => `${src.type}:${src.target}`,
    [],
  )

  const fetchServiceSource = useCallback(
    async (source: LogSource): Promise<LogEntry[]> => {
      try {
        const key = sourceKey(source)
        const pagination = paginationRef.current.get(key)

        const params = new URLSearchParams({ name: source.target })
        if (logSessionRef.current === 'previous') {
          params.set('source', 'old')
        }
        if (pagination?.offset && pagination.timestamp) {
          params.set('offset', String(pagination.offset))
          params.set('since', pagination.timestamp)
        }

        const url = new URL(
          `/api/logs?${params.toString()}`,
          window.location.origin,
        )
        const res = await fetch(url)
        if (!res.ok) return []

        const data: ApiLogResponse = await res.json()

        // Detect log rotation: offset went backwards → file was reset on restart
        if (pagination?.offset && data.offset < pagination.offset) {
          accumulatedRef.current = []
          paginationRef.current.clear()
        }

        // Persist pagination cursor for next poll
        paginationRef.current.set(key, {
          offset: data.offset,
          timestamp: data.timestamp,
        })

        return data.logs.map((entry) => ({
          timestamp: entry.timestamp,
          level: mapTypeToLevel(entry.level ?? 'info'),
          message: entry.message,
          source: source.label,
        }))
      } catch {
        return []
      }
    },
    [sourceKey],
  )

  // ── Fetch API-based ("api") logs through the service proxy ────
  const fetchApiSource = useCallback(
    async (source: LogSource): Promise<LogEntry[]> => {
      if (logSessionRef.current === 'previous') return []
      if (serviceStatusRef.current !== 'active') return []
      try {
        const key = sourceKey(source)
        const pagination = paginationRef.current.get(key)

        const separator = source.target.includes('?') ? '&' : '?'
        let url = `/api/${serviceName}${source.target}`
        if (pagination?.offset && pagination.timestamp) {
          url += `${separator}offset=${pagination.offset}&since=${encodeURIComponent(pagination.timestamp)}`
        }

        const res = await fetch(url)
        if (!res.ok) return []

        const data: ApiLogResponse = await res.json()

        if (pagination?.offset && data.offset < pagination.offset) {
          accumulatedRef.current = []
          paginationRef.current.clear()
        }

        paginationRef.current.set(key, {
          offset: data.offset,
          timestamp: data.timestamp,
        })

        return data.logs.map((entry) => ({
          timestamp: entry.timestamp,
          level: mapApiLevel(entry.level),
          message: entry.message ?? '',
          source: source.label,
        }))
      } catch {
        return []
      }
    },
    [serviceName, sourceKey],
  )

  // ── Single fetch across all sources ───────────────────────────
  const fetchAllSources = useCallback(async (): Promise<LogEntry[]> => {
    const results = await Promise.allSettled(
      sources.map((src) =>
        src.type === 'service' ? fetchServiceSource(src) : fetchApiSource(src),
      ),
    )

    const combined: LogEntry[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        combined.push(...result.value)
      }
    }

    // Sort merged entries by timestamp (parse to Date for reliable ordering)
    combined.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    return combined
  }, [sources, fetchServiceSource, fetchApiSource])

  const currentKey = `${serviceName}:${logSession}:${clearCounter}`

  // ── Use React Query for polling & accumulation ────────────────
  const { data: logs = [], refetch } = useQuery<LogEntry[]>({
    queryKey: [
      'service-logs',
      serviceName,
      sources.map(sourceKey).join(','),
      logSession,
      clearCounter,
    ],
    queryFn: async () => {
      // Reset accumulation when the key changes (session switch, clear, etc.)
      if (accumulatedKeyRef.current !== currentKey) {
        accumulatedKeyRef.current = currentKey
        accumulatedRef.current = []
        paginationRef.current.clear()
      }
      const newEntries = await fetchAllSources()
      if (newEntries.length > 0) {
        accumulatedRef.current = [...accumulatedRef.current, ...newEntries]
          .sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          )
          .slice(-maxEntries)
      }
      return accumulatedRef.current
    },
    // Only live-poll for the current session while the service is online
    refetchInterval: POLL_INTERVAL,
    // Always enabled — offline services still have log files on disk
    enabled: true,
  })

  // ── Reset logs when a new service run begins ─────────────────
  const prevStatusRef = useRef(serviceStatus)
  useEffect(() => {
    if (serviceStatus !== prevStatusRef.current) {
      prevStatusRef.current = serviceStatus

      // A transition into 'starting' means a fresh run — clear accumulated
      // logs and pagination so the viewer starts clean.
      if (serviceStatus === 'starting') {
        accumulatedRef.current = []
        paginationRef.current.clear()
      }

      refetch()
    }
  }, [serviceStatus, refetch])

  const filteredLogs =
    filter === 'ALL' ? logs : logs.filter((l) => l.level === filter)

  const counts: Record<LogFilter, number> = {
    ALL: logs.length,
    INFO: logs.filter((l) => l.level !== 'ERROR').length,
    ERROR: logs.filter((l) => l.level === 'ERROR').length,
  }

  const clear = useCallback(() => {
    setClearCounter((c) => c + 1)
  }, [])

  return {
    logs: filteredLogs,
    counts,
    filter,
    setFilter,
    isPaused,
    setIsPaused,
    logSession,
    setLogSession,
    clear,
    sources,
    refetch,
  }
}
