// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const SERVICES_QUERY_KEY = ['services'] as const

// ─── Types ────────────────────────────────────────────────────────

interface ClearModelCacheVariables {
  serviceId: number
  serviceName: string
}

interface ClearModelCacheResponse {
  cleared: string[]
  errors: string[]
}

// ─── API Call ─────────────────────────────────────────────────────

async function clearModelCache({
  serviceId,
}: ClearModelCacheVariables): Promise<ClearModelCacheResponse> {
  const url = new URL(
    `/api/services/${serviceId}/models`,
    window.location.origin,
  )
  const res = await fetch(url, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Failed to clear model cache (${res.status})`)
  }
  return res.json()
}

// ─── Hook ─────────────────────────────────────────────────────────

/**
 * Mutation hook for clearing a worker service's model cache.
 * On success, invalidates the services query so the UI can reflect
 * the updated state.
 */
export function useClearModelCache() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearModelCache,
    onSuccess: (_data, variables) => {
      toast.success(`Model cache cleared for ${variables.serviceName}`, {
        description: 'Start the service to re-download models.',
      })
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: (err) => {
      toast.error('Failed to clear model cache', {
        description:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    },
  })
}
