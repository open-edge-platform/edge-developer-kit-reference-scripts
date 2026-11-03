// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import type { BackendId } from '@/engines/multiserve/types'
import { fetchJson } from '@/lib/browser/fetch-json'
import { parseInstanceKey } from '@/lib/instances/instances'
import type { CatalogEngine, ModelCatalog } from '@/lib/workers/model-catalog'

/** Model catalogue scanned from disk (`GET /api/services/models`), so it works while the engine is down. */
export type ServiceModelCatalog = ModelCatalog

export interface UseServiceModelCatalogOptions {
  /** Instance to scan when not the primary of `type`; defaults to `type` if that is an instance key. */
  instanceKey?: string
  /** Restrict a multiserve scan to one backend. */
  provider?: BackendId
  /** Overrides the instance's stored engine, for a New-instance draft on the other engine. */
  engine?: CatalogEngine
  enabled?: boolean
  /** Refetch every 15s while enabled (default). Off for long-open pages: they rescan on invalidation. */
  poll?: boolean
}

/** Prefix of every catalogue query: invalidate it once models changed on disk. */
export const MODEL_CATALOG_QUERY_KEY = ['service-model-catalog'] as const

function catalogQueryKey(
  type: string,
  instanceKey: string | undefined,
  provider: BackendId | undefined,
  engine: CatalogEngine | undefined,
) {
  return [
    ...MODEL_CATALOG_QUERY_KEY,
    type,
    instanceKey,
    provider,
    engine,
  ] as const
}

function fetchCatalog(
  type: string,
  instanceKey: string | undefined,
  provider: BackendId | undefined,
  engine: CatalogEngine | undefined,
): Promise<ServiceModelCatalog> {
  const params = new URLSearchParams({ type })
  if (instanceKey) params.set('instance', instanceKey)
  if (provider) params.set('provider', provider)
  if (engine) params.set('engine', engine)
  return fetchJson(`/api/services/models?${params.toString()}`, {
    errorMessage: 'Failed to fetch model catalogue',
  })
}

/** Disk-scanned model catalogue for a service `type` or `type@instanceId`; the server caches it 20s. */
export function useServiceModelCatalog(
  type: string,
  options: UseServiceModelCatalogOptions = {},
) {
  const parsed = parseInstanceKey(type)
  const resolvedType = parsed?.type ?? type
  const instanceKey = options.instanceKey ?? (parsed ? type : undefined)
  const provider = options.provider
  const engine = options.engine
  const enabled = options.enabled ?? true

  return useQuery({
    queryKey: catalogQueryKey(resolvedType, instanceKey, provider, engine),
    queryFn: () => fetchCatalog(resolvedType, instanceKey, provider, engine),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled && (options.poll ?? true) ? 15_000 : false,
  })
}
