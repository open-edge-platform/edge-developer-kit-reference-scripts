// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { toastError } from '@/lib/browser/toast-error'
import type { BackendId, MultiserveModel } from '../types'
import {
  isAbortError,
  type UploadModelParams,
  type UploadProgress,
  uploadModel,
} from '../upload'

type ModelsResponse = Record<string, MultiserveModel[]>

interface DeleteModelParams {
  serviceId: string
  backend: BackendId
  repoId: string
}

// Omit a missing `backend` rather than include `undefined`: partial-match invalidation treats a
// shorter key as a prefix, but an explicit `undefined` element must match exactly.
function modelsQueryKey(serviceId: string, backend?: BackendId) {
  return backend
    ? (['multiserve-models', serviceId, backend] as const)
    : (['multiserve-models', serviceId] as const)
}

function fetchModels(
  serviceId: string,
  backend?: BackendId,
): Promise<ModelsResponse> {
  const query = backend ? `?provider=${encodeURIComponent(backend)}` : ''
  return fetchJson(`/api/${serviceId}/v1/models${query}`, {
    errorMessage: 'Failed to fetch models',
  })
}

async function deleteModel({
  serviceId,
  backend,
  repoId,
}: DeleteModelParams): Promise<void> {
  await postJson(
    `/api/${serviceId}/v1/model/delete`,
    { repo_id: `${backend}:${repoId}` },
    { method: 'DELETE', errorMessage: 'Delete failed' },
  )
}

export function useMultiserveModels(
  serviceId: string,
  backend?: BackendId,
  enabled = true,
) {
  return useQuery({
    queryKey: modelsQueryKey(serviceId, backend),
    queryFn: () => fetchModels(serviceId, backend),
    enabled,
    staleTime: 30_000,
    refetchInterval: 15_000,
  })
}

export function useDeleteModel(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: Omit<DeleteModelParams, 'serviceId'>) =>
      deleteModel({ ...params, serviceId }),
    onSuccess: (_data, variables) => {
      toast.success(`Model ${variables.repoId} deleted`)
      queryClient.invalidateQueries({
        queryKey: modelsQueryKey(serviceId),
      })
    },
    onError: (err, variables) =>
      toastError(`Failed to delete ${variables.repoId}`)(err),
  })
}

/**
 * Chunked upload to the engine (`../upload.ts`); `cancel` stops between two chunks. A cancelled
 * upload is not an error: `error` stays null for it.
 */
export function useUploadModel(serviceId: string) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [controller, setController] = useState<AbortController | null>(null)

  const { mutate, reset, isPending, isSuccess, isError, error } = useMutation({
    mutationFn: (
      params: Omit<UploadModelParams, 'serviceId' | 'signal' | 'onProgress'>,
    ) => {
      const next = new AbortController()
      setController(next)
      setProgress(null)
      return uploadModel({
        ...params,
        serviceId,
        signal: next.signal,
        onProgress: setProgress,
      })
    },
    onSuccess: (data, variables) => {
      toast.success(`Model uploaded: ${data?.repo_id ?? variables.repoId}`)
      queryClient.invalidateQueries({
        queryKey: modelsQueryKey(serviceId),
      })
    },
    onError: (err) => {
      if (isAbortError(err)) {
        toast.info('Upload cancelled')
        return
      }
      toastError('Failed to upload model')(err)
    },
    onSettled: () => setController(null),
  })

  return {
    upload: mutate,
    cancel: () => controller?.abort(),
    reset,
    progress: isPending ? progress : null,
    isPending,
    isSuccess,
    error: isError && !isAbortError(error) ? error : null,
  }
}
