// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'

const API_BASE = '/api/wake-word-detection'

/**
 * One-click start for wake-word detection.
 * Simply starts detection — no webhook subscription needed.
 * Detection events are polled directly from the worker's event buffer.
 */
export function useQuickStart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      deviceId?: number | null
      threshold?: number
    }) => {
      const payload: Record<string, unknown> = {}
      if (params.deviceId != null) payload.device_id = params.deviceId
      if (params.threshold != null) payload.threshold = params.threshold

      const body =
        Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined

      const startRes = await fetch(`${API_BASE}/v1/wake-word-detection/start`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      })
      if (!startRes.ok) throw new Error(await startRes.text())
      return startRes.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'health'],
      })
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'detection-events'],
      })
    },
  })
}
