// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const SERVICES_QUERY_KEY = ['services'] as const

// ─── Types ────────────────────────────────────────────────────────

export interface ServiceConfigUpdate {
  name: string
  device: string
  backend?: string
  source?: string
  type?: string
  quant?: string
  params?: string
  metadata?: Record<string, unknown>
}

interface UpdateServiceConfigVariables {
  serviceId: number
  serviceType: string
  config: ServiceConfigUpdate
}

// ─── API Call ─────────────────────────────────────────────────────

async function updateServiceConfig({
  serviceId,
  config,
}: UpdateServiceConfigVariables): Promise<void> {
  const url = new URL(`/api/services/${serviceId}`, window.location.origin)
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to update service config: ${text}`)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────

/**
 * Mutation hook for updating a service's model configuration and
 * triggering a restart. On success, invalidates the services query
 * so the UI picks up the new model/device.
 */
export function useUpdateServiceConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateServiceConfig,
    onSuccess: () => {
      toast.success('Configuration saved')
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
    },
    onError: (err) => {
      toast.error('Failed to update service configuration', {
        description:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    },
  })
}
