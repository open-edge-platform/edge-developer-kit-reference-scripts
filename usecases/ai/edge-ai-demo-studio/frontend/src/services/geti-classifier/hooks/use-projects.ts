// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

export interface GetiProject {
  id: string
  name: string
  labels: string[]
  creation_time: string | null
  score: number | null
}

export interface ProjectsPayload {
  host: string
  token: string
  verifySsl?: boolean
}

export interface ProjectsResult {
  status: string
  projects: GetiProject[]
  total: number
}

async function fetchProjects(
  payload: ProjectsPayload,
): Promise<ProjectsResult> {
  const res = await fetch('/api/geti-classifier/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: payload.host,
      token: payload.token,
      verify_ssl: payload.verifySsl ?? false,
    }),
  })

  const data = (await res.json()) as ProjectsResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch projects')
  return data
}

export function useProjects(
  options?: UseMutationOptions<ProjectsResult, Error, ProjectsPayload>,
) {
  return useMutation<ProjectsResult, Error, ProjectsPayload>({
    mutationFn: fetchProjects,
    ...options,
  })
}
