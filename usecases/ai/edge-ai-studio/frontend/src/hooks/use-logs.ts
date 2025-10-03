// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { LogResponse } from '@/app/(frontend)/api/logs/route'
import { useQuery } from '@tanstack/react-query'

export const useLogs = (name: string, since?: string, offset?: number) => {
  // Validate 'name' (alphanumeric, dash, underscore only)
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(
      `Invalid log name parameter: "${name}". Expected format: alphanumeric, dash, and underscore only.`,
    )
  }
  // Validate 'since' (ISO 8601 date string)
  if (
    since &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(since)
  ) {
    throw new Error(
      `Invalid since parameter: "${since}". Expected format: ISO 8601 date string.`,
    )
  }
  // Validate 'offset' (non-negative integer)
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error(
      `Invalid offset parameter: "${offset}". Expected format: non-negative integer.`,
    )
  }

  // Denylist for suspicious characters
  const denylist = /[.]{2}|[\\/%?#&=<>;\x00-\x1F\x7F]/
  const decodedName = decodeURIComponent(name)
  if (denylist.test(decodedName)) {
    throw new Error(
      `Log name contains forbidden characters: "${name}". Forbidden characters include "..", "\\", "/", "%", "?", "#", "&", "=", "<>", ";", and control characters.`,
    )
  }
  if (since) {
    const decodedSince = decodeURIComponent(since)
    if (denylist.test(decodedSince)) {
      throw new Error(
        `Since parameter contains forbidden characters: "${since}". Forbidden characters include "..", "\\", "/", "%", "?", "#", "&", "=", "<>", ";", and control characters.`,
      )
    }
  }
  if (offset !== undefined) {
    const decodedOffset = decodeURIComponent(offset.toString())
    if (denylist.test(decodedOffset)) {
      throw new Error(
        `Offset parameter contains forbidden characters: "${offset}". Forbidden characters include "..", "\\", "/", "%", "?", "#", "&", "=", "<>", ";", and control characters.`,
      )
    }
  }

  return useQuery({
    queryKey: ['logs', name, since, offset],
    queryFn: async () => {
      // Use URL API to construct the URL and append search params directly
      const url = new URL('/api/logs', window.location.origin)
      url.searchParams.set('name', name)
      if (since && offset !== undefined) {
        url.searchParams.set('since', since)
        url.searchParams.set('offset', offset.toString())
      }
      // Extra check: ensure URL is local and path is correct
      if (
        url.origin !== window.location.origin ||
        url.pathname !== '/api/logs'
      ) {
        throw new Error('URL manipulation detected')
      }
      // Pass the URL object directly to fetch
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch logs')
      }
      const data = await response.json()
      return data as LogResponse
    },
    refetchInterval: 10000,
  })
}
