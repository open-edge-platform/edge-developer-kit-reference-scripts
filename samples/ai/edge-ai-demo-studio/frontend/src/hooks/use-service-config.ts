// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const SERVICES_QUERY_KEY = ['services'] as const

export interface ServiceConfigUpdate {
  name?: string
  device?: string
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

export async function updateServiceConfig({
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
