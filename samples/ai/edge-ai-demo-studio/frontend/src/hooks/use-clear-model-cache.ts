// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchJson } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'
import { MODEL_CATALOG_QUERY_KEY } from '@/hooks/use-model-catalog'
import { SERVICES_QUERY_KEY } from '@/hooks/use-services'

interface ClearModelCacheVariables {
  /** The service type: its instances all share one cache. */
  type: string
  serviceName: string
}

interface ClearModelCacheResponse {
  cleared?: string[]
  errors?: string[]
}

function clearModelCache({
  type,
}: ClearModelCacheVariables): Promise<ClearModelCacheResponse | undefined> {
  const query = new URLSearchParams({ type })
  return fetchJson(`/api/services/models/cache?${query.toString()}`, {
    method: 'DELETE',
    errorMessage: 'Failed to clear model cache',
  })
}

export function useClearModelCache() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearModelCache,
    onSuccess: (data, variables) => {
      // The route answers 200 even when a folder could not be removed: it
      // lists those in `errors`, which must not read as a clean success.
      const cleared = data?.cleared ?? []
      const errors = data?.errors ?? []
      if (errors.length > 0) {
        toast.error(
          cleared.length > 0
            ? `Model cache partly cleared for ${variables.serviceName}`
            : `Failed to clear model cache for ${variables.serviceName}`,
          { description: errors.join('\n') },
        )
      } else {
        toast.success(`Model cache cleared for ${variables.serviceName}`, {
          description: 'Start the service to re-download models.',
        })
      }
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY })
      // Every type's: a cleared folder may hold another service's models.
      queryClient.invalidateQueries({ queryKey: MODEL_CATALOG_QUERY_KEY })
    },
    onError: toastError('Failed to clear model cache'),
  })
}
