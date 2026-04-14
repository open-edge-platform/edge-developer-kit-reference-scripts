// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

async function fetchEngineHealth(serviceId: string): Promise<boolean> {
  const url = new URL(`/api/${serviceId}/v1/health`, window.location.origin)
  const res = await fetch(url)
  if (!res.ok) return false
  const data = await res.json()
  return data?.health?.['llama.cpp'] === 'OK' && data?.health?.ovms === 'OK'
}

export function useEngineHealth(serviceId: string, enabled = true) {
  return useQuery({
    queryKey: ['multiserve-engine-health', serviceId],
    queryFn: () => fetchEngineHealth(serviceId),
    enabled,
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: false,
  })
}

const ENGINE_START_KEY = ['start-engine'] as const

async function startEngine(dbId: number): Promise<void> {
  const url = new URL(`/api/services/${dbId}/engine`, window.location.origin)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Failed to start engine: ${res.status}`)
  }
}

export function useStartEngine(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ENGINE_START_KEY,
    mutationFn: startEngine,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['multiserve-engine-health', serviceId],
      })
    },
    onError: (err) => {
      toast.error('Failed to start engine', {
        description:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    },
  })
}

export function useIsEngineStarting() {
  return useIsMutating({ mutationKey: ENGINE_START_KEY }) > 0
}
