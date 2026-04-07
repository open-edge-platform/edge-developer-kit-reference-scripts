// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { MULTISERVE_ENGINES } from '@/lib/engine/multiserve'
import { Workload } from '@/payload-types'
import { LogResponse } from '@/types/log'
import { useQuery, UseQueryResult } from '@tanstack/react-query'

/**
 * Validates log name parameter (alphanumeric, dash, underscore only)
 */
const validateLogName = (name: string): void => {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(
      `Invalid log name parameter: "${name}". Expected format: alphanumeric, dash, and underscore only.`,
    )
  }
}

/**
 * Validates since parameter (ISO 8601 date string)
 */
const validateSinceParameter = (since?: string): void => {
  if (
    since &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(since)
  ) {
    throw new Error(
      `Invalid since parameter: "${since}". Expected format: ISO 8601 date string.`,
    )
  }
}

/**
 * Validates offset parameter (non-negative integer)
 */
const validateOffsetParameter = (offset?: number): void => {
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error(
      `Invalid offset parameter: "${offset}". Expected format: non-negative integer.`,
    )
  }
}

/**
 * Validates parameter against denylist of suspicious characters
 */
const validateAgainstDenylist = (
  value: string,
  parameterName: string,
  originalValue: string | number,
): void => {
  const denylist = /[.]{2}|[\\/%?#&=<>;\x00-\x1F\x7F]/
  const decodedValue = decodeURIComponent(value)

  if (denylist.test(decodedValue)) {
    throw new Error(
      `${parameterName} contains forbidden characters: "${originalValue}". Forbidden characters include "..", "\\", "/", "%", "?", "#", "&", "=", "<>", ";", and control characters.`,
    )
  }
}

/**
 * Validates all parameters for security and format compliance
 */
const validateParameters = (
  name: string,
  since?: string,
  offset?: number,
): void => {
  // Format validation
  validateLogName(name)
  validateSinceParameter(since)
  validateOffsetParameter(offset)

  // Security validation against denylist
  validateAgainstDenylist(name, 'Log name parameter', name)

  if (since) {
    validateAgainstDenylist(since, 'Since parameter', since)
  }

  if (offset !== undefined) {
    validateAgainstDenylist(offset.toString(), 'Offset parameter', offset)
  }
}

/**
 * Constructs and validates the API URL for fetching logs
 */
const buildLogsUrl = (
  path: string,
  name: string,
  since?: string,
  offset?: number,
): URL => {
  const url = new URL(path, window.location.origin)
  url.searchParams.set('name', name)

  if (since && offset !== undefined) {
    url.searchParams.set('since', since)
    url.searchParams.set('offset', offset.toString())
  }

  // Security check: ensure URL is local and path is correct
  const validPaths = [
    '/api/logs',
    '/api/text-generation/v1/logs',
    '/api/embeddings/v1/logs',
  ]
  const isValidPath = validPaths.includes(url.pathname)

  if (url.origin !== window.location.origin || !isValidPath) {
    throw new Error('URL manipulation detected')
  }

  return url
}

/**
 * Fetches logs from a single API endpoint
 */
const fetchLogsFromEndpoint = async (
  path: string,
  name: string,
  since?: string,
  offset?: number,
): Promise<LogResponse> => {
  const url = buildLogsUrl(path, name, since, offset)
  const response = await fetch(new URL(url))
  if (!response.ok) {
    throw new Error(`Failed to fetch logs from ${path}`)
  }

  return (await response.json()) as LogResponse
}

/**
 * Fetches logs from custom engine (single API call)
 */
const fetchCustomEngineLogs = async (
  name: string,
  since?: string,
  offset?: number,
): Promise<LogResponse> => {
  return fetchLogsFromEndpoint('/api/logs', name, since, offset)
}

/**
 * Fetches logs from multiserve engine endpoint
 */
const fetchMultiserveLogs = async (
  type: Workload['type'],
  name: string,
  since?: string,
  offset?: number,
): Promise<LogResponse> => {
  const [multiserveLogs, serverLogs] = await Promise.allSettled([
    fetchLogsFromEndpoint(
      `/api/${type}/v1/logs`,
      type.replace('-', '_'),
      since,
      offset,
    ),
    fetchCustomEngineLogs(name, since, offset),
  ])

  const multiserveLogsResult =
    multiserveLogs.status === 'fulfilled'
      ? multiserveLogs.value
      : { logs: [], offset: 0, timestamp: new Date().toISOString() }

  const serverLogsResult =
    serverLogs.status === 'fulfilled'
      ? serverLogs.value
      : { logs: [], offset: 0, timestamp: new Date().toISOString() }

  return combineAndSortLogs(multiserveLogsResult, serverLogsResult)
}

/**
 * Combines and sorts logs from multiple sources
 */
const combineAndSortLogs = (
  multiserveLogs: LogResponse,
  apiLogs: LogResponse,
): LogResponse => {
  const combinedLogs = [...multiserveLogs.logs, ...apiLogs.logs]

  // Sort by timestamp (ascending order)
  combinedLogs.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  })

  return {
    logs: combinedLogs,
    offset: Math.max(multiserveLogs.offset, apiLogs.offset),
    timestamp: multiserveLogs.timestamp || apiLogs.timestamp,
  }
}

/**
 * Fetches logs data from the API
 */
const fetchLogs = async (
  name: string,
  engine: Workload['engine'],
  type: Workload['type'],
  since?: string,
  offset?: number,
): Promise<LogResponse> => {
  if (engine === 'custom') {
    return fetchCustomEngineLogs(name, since, offset)
  } else if (MULTISERVE_ENGINES.map((e) => e.id).includes(engine)) {
    return fetchMultiserveLogs(type, name, since, offset)
  }

  const data = { logs: [], offset: 0, timestamp: new Date().toISOString() }
  return data
}

/**
 * Custom hook for fetching and managing logs data
 */
export const useLogs = (
  name: string,
  engine: Workload['engine'],
  type: Workload['type'],
  since?: string,
  offset?: number,
  enabled?: boolean,
) => {
  validateParameters(name, since, offset)

  return useQuery({
    queryKey: ['logs', name, engine],
    queryFn: () => fetchLogs(name, engine, type, since, offset),
    refetchInterval: 10000,
    enabled,
  })
}

/**
 * Fetches archived (previous run) logs for a process from logs/old/<name>.log.
 * Single fetch — no polling — since the archive only changes on new process start.
 */
export const useOldLogs = (
  name: string,
  enabled?: boolean,
): UseQueryResult<LogResponse, Error> => {
  validateLogName(name)

  return useQuery<LogResponse>({
    queryKey: ['logs-old', name],
    queryFn: async () => {
      const url = new URL('/api/logs', window.location.origin)
      url.searchParams.set('name', name)
      url.searchParams.set('source', 'old')
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          return { logs: [], offset: 0, timestamp: null }
        }
        throw new Error('Failed to fetch previous logs')
      }
      return (await response.json()) as LogResponse
    },
    enabled,
    staleTime: Infinity,
  })
}
