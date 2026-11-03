// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { ServiceStatus } from '@/services/types'
import type { LogSource } from '@/types/common'
import {
  type Accumulated,
  applyRound,
  emptyAccumulated,
  type LogEntry,
  type LogSnapshot,
  type SourceState,
} from '../log-accumulator'
import {
  logSourceKey,
  logUrl,
  type LogRun,
  readSource,
  type SourceNote,
} from '../log-transport'
import {
  type LogFilterAddress,
  type LogFilters,
  useLogFilters,
} from './use-log-filters'

export type { LogEntry } from '../log-accumulator'
export type { LogRun } from '../log-transport'
export type {
  LevelFilter,
  LogFilterAddress,
  LogFilters,
} from './use-log-filters'

export interface SourceProblem {
  label: string
  message: string
}

interface UseLogOptions {
  sources: LogSource[]
  serviceName: string
  serviceStatus?: ServiceStatus
  maxEntries?: number
  maxBytes?: number
  /** Polling pauses while false, e.g. a force-mounted but hidden tab panel. */
  active?: boolean
  /** Paths the app polls (health checks, log reads); their successful GETs are hidden by default. */
  pollingPaths?: string[]
  /** Keep the level and source filters in the page address. */
  filterAddress?: LogFilterAddress
}

/** The lines a view has read and how its sources are doing. */
export interface LogFeed {
  /** Every retained line, oldest first, before any filter. */
  retained: LogEntry[]
  newestId: number
  maxEntries: number
  /** No read has settled yet for this run. */
  isLoading: boolean
  lastUpdatedAt: number | null
  /** Every source read failed on the latest round. */
  totalFailure: boolean
  failedSources: SourceProblem[]
  /** Sources not read now: no history for a previous run, not up yet, or stopped. */
  unavailableSources: SourceProblem[]
  refetch: () => Promise<unknown>
}

/** Why a worker API's log is not read now, after its label. */
const NOTE_MESSAGES: Record<SourceNote, string> = {
  'no-history': 'not available for previous runs',
  'not-ready': 'not available yet',
  stopped: 'not available while the service is stopped',
}

const POLL_INTERVAL = 3_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const NO_ENTRIES: LogEntry[] = []
const NO_SOURCES: SourceState[] = []
const NO_PATHS: string[] = []

/** Polls an instance's log sources, keeping the latest `maxEntries` lines and each source's health. */
function useLogFeed({
  sources,
  serviceName,
  serviceStatus,
  maxEntries = 500,
  maxBytes = DEFAULT_MAX_BYTES,
  active = true,
  run,
  hiddenPaths,
}: Omit<UseLogOptions, 'pollingPaths' | 'filterAddress'> & {
  run: LogRun
  hiddenPaths: string[]
}): LogFeed {
  const statusRef = useRef(serviceStatus)
  const accumulatedRef = useRef<Accumulated>(emptyAccumulated(''))

  // Each view owns its accumulator, so two panels on the same instance must
  // not share one query and advance each other's cursors.
  const viewId = useId()
  const sourcesKey = sources.map(logSourceKey).join(',')
  // Polling is filtered as lines arrive: toggling it reads the tail afresh.
  const hiddenKey = hiddenPaths.join(',')
  const viewKey = `${serviceName}|${run}|${sourcesKey}|${hiddenKey}`

  const { data, refetch } = useQuery<LogSnapshot>({
    queryKey: ['service-logs', viewId, serviceName, run, sourcesKey, hiddenKey],
    queryFn: async ({ signal }) => {
      if (accumulatedRef.current.viewKey !== viewKey) {
        accumulatedRef.current = emptyAccumulated(
          viewKey,
          accumulatedRef.current.nextId,
        )
      }
      const acc = accumulatedRef.current
      const status = statusRef.current
      const results = await Promise.all(
        sources.map((src) =>
          readSource(
            src,
            logUrl(
              src,
              serviceName,
              run,
              acc.cursors.get(logSourceKey(src)),
              hiddenPaths,
            ),
            run,
            status,
            signal,
          ),
        ),
      )
      // A cancelled round (Refresh, a status change) must not move cursors.
      signal.throwIfAborted()

      return applyRound(
        acc,
        sources,
        results,
        maxEntries,
        maxBytes,
        hiddenPaths,
      )
    },
    enabled: active,
    refetchInterval: active ? POLL_INTERVAL : false,
    // Per-view queries: nothing to reuse once the view is gone.
    gcTime: 0,
  })

  const prevStatusRef = useRef(serviceStatus)
  useEffect(() => {
    statusRef.current = serviceStatus
    if (serviceStatus === prevStatusRef.current) return
    prevStatusRef.current = serviceStatus
    if (serviceStatus === 'starting') {
      // A start archives the previous log: read both runs afresh.
      accumulatedRef.current = emptyAccumulated(
        '',
        accumulatedRef.current.nextId,
      )
    }
    if (active) refetch()
  }, [serviceStatus, refetch, active])

  const prevActiveRef = useRef(active)
  useEffect(() => {
    // Visible again: catch up now instead of waiting for the next poll.
    if (active && !prevActiveRef.current) refetch()
    prevActiveRef.current = active
  }, [active, refetch])

  const sourceStates = data?.sources ?? NO_SOURCES
  const read = sourceStates.filter((s) => !s.note)
  const failedSources: SourceProblem[] = read
    .filter((s) => s.error !== null)
    .map((s) => ({ label: s.label, message: s.error ?? '' }))
  const totalFailure = read.length > 0 && failedSources.length === read.length
  const successTimes = sourceStates
    .map((s) => s.lastSuccessAt)
    .filter((t): t is number => t !== null)
  const lastUpdatedAt =
    successTimes.length > 0 ? Math.max(...successTimes) : null

  return {
    retained: data?.entries ?? NO_ENTRIES,
    newestId: data?.newestId ?? 0,
    maxEntries,
    isLoading: data === undefined,
    lastUpdatedAt,
    totalFailure,
    failedSources,
    unavailableSources: sourceStates.flatMap((s) =>
      s.note ? [{ label: s.label, message: NOTE_MESSAGES[s.note] }] : [],
    ),
    refetch,
  }
}

export interface LogView {
  feed: LogFeed
  /** The retained lines the filters let through. */
  entries: LogEntry[]
  filters: LogFilters
  run: LogRun
  setRun: (run: LogRun) => void
  /** Successful GETs of the polled paths are left out. */
  hidePolling: boolean
  setHidePolling: Dispatch<SetStateAction<boolean>>
}

/** A log view of an instance: the polled feed, the reader's filters, the run read and polling toggle. */
export function useLog({
  pollingPaths = NO_PATHS,
  filterAddress,
  ...options
}: UseLogOptions): LogView {
  const [run, setRun] = useState<LogRun>('current')
  const [hidePolling, setHidePolling] = useState(true)
  const feed = useLogFeed({
    ...options,
    run,
    hiddenPaths: hidePolling ? pollingPaths : NO_PATHS,
  })
  const { entries, filters } = useLogFilters(
    feed.retained,
    options.sources,
    filterAddress,
  )
  return { feed, entries, filters, run, setRun, hidePolling, setHidePolling }
}
