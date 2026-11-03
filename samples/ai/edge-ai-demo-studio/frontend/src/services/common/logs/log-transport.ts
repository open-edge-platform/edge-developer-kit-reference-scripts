// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Reading one log source: its URL for a run and cursor, and the result of one read. */

import { fetchJson, isHttpError } from '@/lib/browser/fetch-json'
import type { ServiceStatus } from '@/services/types'
import type { ApiLogResponse, LogSource } from '@/types/common'

export type LogRun = 'current' | 'previous'

/** A source that is not read right now, and why. */
export type SourceNote = 'no-history' | 'not-ready' | 'stopped'

/** Where the next read of a source continues. */
export interface Cursor {
  offset: number
  timestamp: string | null
}

export interface SourceResult {
  /** `null` when the source has no log file yet. */
  page?: ApiLogResponse | null
  error?: string
  note?: SourceNote
}

export function logSourceKey(src: LogSource): string {
  return `${src.type}:${src.target}`
}

/**
 * URL of a source's next page: a worker API's log path, or `/api/logs` for a process or engine log,
 * which filters hidden (polled) paths as it reads the file so polling cannot crowd out the tail.
 */
export function logUrl(
  source: LogSource,
  serviceName: string,
  run: LogRun,
  cursor: Cursor | undefined,
  hiddenPaths: string[],
): string {
  const page =
    cursor?.offset && cursor.timestamp
      ? `offset=${cursor.offset}&since=${encodeURIComponent(cursor.timestamp)}`
      : ''
  if (source.type === 'api') {
    const separator = source.target.includes('?') ? '&' : '?'
    return `/api/${serviceName}${source.target}${page && separator}${page}`
  }
  // An engine's log is the instance's (`serviceName`) in that engine.
  const params =
    source.type === 'engine'
      ? new URLSearchParams({ name: serviceName, engine: source.target })
      : new URLSearchParams({ name: source.target })
  if (run === 'previous') params.set('source', 'old')
  for (const path of hiddenPaths) params.append('hide', path)
  return `/api/logs?${params.toString()}${page && `&${page}`}`
}

/** One read of a source; rejects only when `signal` aborted it. */
export async function readSource(
  source: LogSource,
  url: string,
  run: LogRun,
  status: ServiceStatus | undefined,
  signal: AbortSignal,
): Promise<SourceResult> {
  if (source.type === 'api') {
    // A worker API serves the running process only.
    if (run === 'previous') return { note: 'no-history' }
    if (status === 'offline' || status === 'error') return { note: 'stopped' }
  }
  try {
    const data = await fetchJson<ApiLogResponse | undefined>(url, { signal })
    if (data === undefined) return { page: null }
    if (!Array.isArray(data?.logs)) return { error: 'Unexpected response' }
    return { page: data }
  } catch (err) {
    if (signal.aborted) throw err
    // No log file yet: the process has not written anything.
    if (isHttpError(err, 404)) return { page: null }
    // The worker's HTTP server comes up partway through startup.
    if (source.type === 'api' && status === 'starting') {
      return { note: 'not-ready' }
    }
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
