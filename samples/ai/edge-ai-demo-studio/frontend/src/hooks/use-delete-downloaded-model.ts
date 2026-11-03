// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchJson } from '@/lib/browser/fetch-json'
import { MODEL_CATALOG_QUERY_KEY } from '@/hooks/use-model-catalog'

interface DeleteDownloadedModelVariables {
  type: string
  instanceKey?: string
  model: string
  /** How the model is named in the toast. */
  label: string
}

interface DeleteDownloadedModelResponse {
  deleted?: string[]
  errors?: string[]
}

function deleteDownloadedModel({
  type,
  instanceKey,
  model,
}: DeleteDownloadedModelVariables): Promise<
  DeleteDownloadedModelResponse | undefined
> {
  const query = new URLSearchParams({ type, model })
  if (instanceKey) query.set('instance', instanceKey)
  return fetchJson(`/api/services/models?${query.toString()}`, {
    method: 'DELETE',
    errorMessage: 'Failed to delete the model',
  })
}

/**
 * Deletes one downloaded model of a worker service from disk. A failed request rejects for the
 * caller's dialog to show; a partial delete toasts what failed.
 */
export function useDeleteDownloadedModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDownloadedModel,
    onSuccess: (data, variables) => {
      const errors = data?.errors ?? []
      if (errors.length > 0) {
        toast.error(`Could not delete all of ${variables.label}`, {
          description: errors.join('\n'),
        })
      } else {
        toast.success(`Deleted ${variables.label}`, {
          description: 'It is downloaded again the next time it starts.',
        })
      }
    },
    // Even a refused delete may have raced a change on disk.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: MODEL_CATALOG_QUERY_KEY }),
  })
}
