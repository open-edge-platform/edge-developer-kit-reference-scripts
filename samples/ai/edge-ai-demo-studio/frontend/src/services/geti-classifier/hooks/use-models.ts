// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

export interface GetiModel {
  id: string
  name: string
  version: number | null
  score: number | null
  is_active: boolean
  creation_date: string | null
  precision: string[]
  size: number | null
  lifecycle_stage: string
}

export interface ModelsPayload {
  host: string
  token: string
  projectId?: string
  projectName?: string
  verifySsl?: boolean
}

export interface ModelsResult {
  status: string
  models: GetiModel[]
  total: number
}

async function fetchModels(payload: ModelsPayload): Promise<ModelsResult> {
  const res = await fetch('/api/geti-classifier/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: payload.host,
      token: payload.token,
      project_id: payload.projectId ?? null,
      project_name: payload.projectName ?? null,
      verify_ssl: payload.verifySsl ?? false,
    }),
  })

  const data = (await res.json()) as ModelsResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch models')
  return data
}

export function useModels(
  options?: UseMutationOptions<ModelsResult, Error, ModelsPayload>,
) {
  return useMutation<ModelsResult, Error, ModelsPayload>({
    mutationFn: fetchModels,
    ...options,
  })
}
