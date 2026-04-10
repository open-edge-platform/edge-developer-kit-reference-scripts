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

/** Check whether the multiserve engine is reachable on this service's port. */
async function fetchEngineHealth(serviceId: string): Promise<boolean> {
  const url = new URL(`/api/${serviceId}/v1/health`, window.location.origin)
  const res = await fetch(url)
  if (!res.ok) return false
  const data = await res.json()
  return data?.health?.['llama.cpp'] === 'OK' && data?.health?.ovms === 'OK'
}

/**
 * Polls the multiserve engine health endpoint for a given service.
 * Returns `true` once the engine process is up and responding,
 * regardless of whether a model has been loaded.
 */
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

/** Start the multiserve engine for a service (without loading a model). */
async function startEngine(dbId: number): Promise<void> {
  const url = new URL(`/api/services/${dbId}/engine`, window.location.origin)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Failed to start engine: ${res.status}`)
  }
}

/**
 * Mutation to start the multiserve engine process for a service.
 * On success, invalidates the engine health query so the UI updates.
 */
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

/** Returns `true` if any start-engine mutation is in-flight (from any component). */
export function useIsEngineStarting() {
  return useIsMutating({ mutationKey: ENGINE_START_KEY }) > 0
}
