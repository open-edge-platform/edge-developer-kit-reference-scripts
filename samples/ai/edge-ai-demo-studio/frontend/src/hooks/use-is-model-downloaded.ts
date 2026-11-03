// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/browser/fetch-json'

interface ModelCacheResponse {
  downloaded: boolean
  /** Other services with a model folder in common (the Hugging Face cache). */
  sharedWith?: string[]
}

function modelCacheQuery(serviceId: number | undefined) {
  return {
    queryKey: ['services', serviceId, 'models', 'downloaded'],
    queryFn: () =>
      fetchJson<ModelCacheResponse>(`/api/services/${serviceId}/models`, {
        errorMessage: 'Failed to check model download status',
      }),
  }
}

export function useIsModelDownloaded(
  serviceId: number | undefined,
  enabled = true,
): boolean | undefined {
  const { data } = useQuery({
    ...modelCacheQuery(serviceId),
    enabled: enabled && serviceId !== undefined,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  if (data === undefined) return undefined
  return data.downloaded
}

/**
 * Names of the services whose files clearing the model cache of `type` removes too; asked per
 * type, so a service nobody added can ask.
 */
export function useModelCacheSharedWith(
  type: string,
  enabled = true,
): string[] {
  const { data } = useQuery({
    queryKey: ['model-cache', type, 'shared-with'],
    queryFn: () =>
      fetchJson<ModelCacheResponse>(
        `/api/services/models/cache?${new URLSearchParams({ type }).toString()}`,
        { errorMessage: 'Failed to check the model cache' },
      ),
    enabled,
    staleTime: 60_000,
  })
  return data?.sharedWith ?? []
}
