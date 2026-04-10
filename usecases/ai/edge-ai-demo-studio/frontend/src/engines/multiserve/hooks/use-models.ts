// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BackendId, MultiserveModel } from '../types'

// ─── Types ────────────────────────────────────────────────────────

/** Response shape from GET /v1/model — keyed by backend. */
type ModelsResponse = Record<string, MultiserveModel[]>

interface DeleteModelParams {
  serviceId: string
  backend: BackendId
  repoId: string
}

interface UploadModelParams {
  serviceId: string
  backend: BackendId
  repoId: string
  task: string
  files: File[]
  forceOverride?: boolean
}

interface UploadModelResponse {
  message: string
  repo_id: string
  internal_path: string
  task: string
}

// ─── Query Keys ───────────────────────────────────────────────────

function modelsQueryKey(serviceId: string, backend?: BackendId) {
  return ['multiserve-models', serviceId, backend] as const
}

// ─── API Functions ────────────────────────────────────────────────

async function fetchModels(
  serviceId: string,
  backend?: BackendId,
): Promise<ModelsResponse> {
  const url = new URL(`/api/${serviceId}/v1/models`, window.location.origin)
  if (backend) url.searchParams.set('provider', backend)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`)
  }
  return res.json()
}

async function deleteModel({
  serviceId,
  backend,
  repoId,
}: DeleteModelParams): Promise<void> {
  const url = new URL(
    `/api/${serviceId}/v1/model/delete`,
    window.location.origin,
  )
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: `${backend}:${repoId}` }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Delete failed: ${res.status}`)
  }
}

async function uploadModel({
  serviceId,
  backend,
  repoId,
  task,
  files,
  forceOverride,
}: UploadModelParams): Promise<UploadModelResponse> {
  const formData = new FormData()
  formData.append('repo_id', `${backend}:${repoId}`)
  formData.append('task', task)
  if (forceOverride) {
    formData.append('force_override', 'true')
  }
  for (const file of files) {
    formData.append('files', file)
  }
  const url = new URL(
    `/api/${serviceId}/v1/model/upload`,
    window.location.origin,
  )
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Upload failed: ${res.status}`)
  }
  return res.json()
}

// ─── Hooks ────────────────────────────────────────────────────────

/**
 * Fetches the model registry from the multiserve engine.
 * Returns models grouped by backend (llamacpp / openvino).
 */
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

/**
 * Mutation to delete a model from disk via the multiserve engine.
 * Invalidates the models query on success.
 */
export function useDeleteModel(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: Omit<DeleteModelParams, 'serviceId'>) =>
      deleteModel({ ...params, serviceId }),
    onSuccess: (_data, variables) => {
      toast.success(`Model ${variables.repoId} deleted`)
      queryClient.invalidateQueries({
        queryKey: ['multiserve-models', serviceId],
      })
    },
    onError: (err, variables) => {
      toast.error(`Failed to delete ${variables.repoId}`, {
        description:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    },
  })
}

/**
 * Mutation to upload a local model file to the multiserve engine.
 * Invalidates the models query on success.
 */
export function useUploadModel(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: Omit<UploadModelParams, 'serviceId'>) =>
      uploadModel({ ...params, serviceId }),
    onSuccess: (data) => {
      toast.success(`Model uploaded: ${data.repo_id}`)
      queryClient.invalidateQueries({
        queryKey: ['multiserve-models', serviceId],
      })
    },
    onError: (err) => {
      toast.error('Failed to upload model', {
        description:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      })
    },
  })
}
