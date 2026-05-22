// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_BASE = '/api/wake-word-detection'

export interface DetectionEvent {
  event: string
  model: string
  score: number
  timestamp: string
  message: string
}

/**
 * Polls the worker's detection events endpoint directly.
 * Only polls while detection is active for efficiency.
 */
export function useDetectionEvents(enabled: boolean) {
  const sinceRef = useRef('')
  const queryClient = useQueryClient()

  const query = useQuery<DetectionEvent[]>({
    queryKey: ['wake-word-detection', 'detection-events'],
    enabled,
    refetchInterval: enabled ? 500 : false,
    queryFn: async () => {
      const params = sinceRef.current ? `?since=${sinceRef.current}` : ''
      const res = await fetch(
        `${API_BASE}/v1/wake-word-detection/events${params}`,
      )
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const newEvents: DetectionEvent[] = data.events ?? []

      if (newEvents.length > 0) {
        // Track the latest timestamp for incremental polling
        sinceRef.current = newEvents[0].timestamp
      }

      // Merge with existing cached events
      const existing =
        queryClient.getQueryData<DetectionEvent[]>([
          'wake-word-detection',
          'detection-events',
        ]) ?? []

      const existingKeys = new Set(
        existing.map((e) => `${e.timestamp}-${e.model}`),
      )
      const deduped = newEvents.filter(
        (e) => !existingKeys.has(`${e.timestamp}-${e.model}`),
      )

      return [...deduped, ...existing].slice(0, 200)
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      await fetch(`${API_BASE}/v1/wake-word-detection/events`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      sinceRef.current = ''
      queryClient.setQueryData(['wake-word-detection', 'detection-events'], [])
    },
  })

  const resetSince = useCallback(() => {
    sinceRef.current = ''
  }, [])

  return {
    events: query.data ?? [],
    latestEvent: query.data?.[0] ?? null,
    clearEvents: clearMutation.mutate,
    resetSince,
  }
}
