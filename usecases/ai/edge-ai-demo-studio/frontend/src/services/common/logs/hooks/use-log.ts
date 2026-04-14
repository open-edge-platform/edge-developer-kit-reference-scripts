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

function mapTypeToLevel(type: string): LogLevel {
  if (type === 'error') return 'ERROR'
  if (type === 'info') return 'INFO'
  return 'INFO'
}

function mapApiLevel(level: string | undefined): LogLevel {
  if (!level) return 'INFO'
  const upper = level.toUpperCase()
  if (upper === 'ERROR' || upper === 'ERR') return 'ERROR'
  return 'INFO'
}

export type LogFilter = 'ALL' | 'INFO' | 'ERROR'

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

    combined.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    return combined
  }, [sources, fetchServiceSource, fetchApiSource])

  const currentKey = `${serviceName}:${logSession}:${clearCounter}`

  const { data: logs = [], refetch } = useQuery<LogEntry[]>({
    queryKey: [
      'service-logs',
      serviceName,
      sources.map(sourceKey).join(','),
      logSession,
      clearCounter,
    ],
    queryFn: async () => {
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
    refetchInterval: POLL_INTERVAL,
    enabled: true,
  })

  const prevStatusRef = useRef(serviceStatus)
  useEffect(() => {
    if (serviceStatus !== prevStatusRef.current) {
      prevStatusRef.current = serviceStatus

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
