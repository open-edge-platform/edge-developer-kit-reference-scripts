// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/browser/fetch-json'
import { MONITORING_POLL_INTERVAL_MS } from '@/lib/monitoring-interval'
// Type-only: nothing server-side reaches the client bundle.
import type { SystemMonitoringOverview } from '@/lib/system/system-monitoring'

/** The shortest wait between polls, when a request took a whole interval. */
const MIN_POLL_WAIT_MS = 1_000

/** How long the latest request took: the server samples while it waits. */
let lastRequestMs = 0

const fetchOverview = async () => {
  const startedAt = Date.now()
  try {
    return await fetchJson<SystemMonitoringOverview>(
      '/api/system-monitoring?metric=overview',
      { errorMessage: 'Failed to load system monitoring' },
    )
  } finally {
    lastRequestMs = Date.now() - startedAt
  }
}

/**
 * Starts the next request one interval after the last one started: React Query times
 * `refetchInterval` from each response, and a request takes ~2 s (qmassa's sample).
 */
const untilNextPoll = () =>
  Math.max(MONITORING_POLL_INTERVAL_MS - lastRequestMs, MIN_POLL_WAIT_MS)

/** `GET /api/system-monitoring`, polled: CPU, system memory, GPUs, NPU, and why any reading is missing. */
export const useSystemMonitoringOverview = () => {
  return useQuery({
    queryKey: ['systemMonitoring', 'overview'],
    queryFn: fetchOverview,
    refetchInterval: untilNextPoll,
    retry: (failureCount: number): boolean => failureCount < 3,
  })
}
