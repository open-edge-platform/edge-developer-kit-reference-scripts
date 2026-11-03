// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { downloadBlob } from '@/lib/browser/download'
import { toastError } from '@/lib/browser/toast-error'
import {
  SERVICE_NAME,
  assetPath,
  createProject,
  deleteAsset,
  deleteProject,
  exportProject,
  fetchHistory,
  fetchProjects,
} from '../lib/api'

const projectsKey = (apiBase: string | undefined) =>
  ['synthetic-image-generation', 'projects', apiBase] as const
const historyKey = (apiBase: string | undefined) =>
  ['synthetic-image-generation', 'history', apiBase] as const

/** The worker's projects and every generated image's URL (newest first), once the instance is online. */
export function useProjectsAndHistory(
  apiBase: string | undefined,
  enabled: boolean,
) {
  const projects = useQuery({
    queryKey: projectsKey(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchProjects(apiBase)
    },
    enabled: enabled && Boolean(apiBase),
  })
  const history = useQuery({
    queryKey: historyKey(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchHistory(apiBase)
    },
    enabled: enabled && Boolean(apiBase),
  })
  return {
    projects: projects.data ?? [],
    historyUrls: history.data ?? [],
  }
}

/** Creates a project; resolves with the name the worker gave it. */
export function useCreateProject(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return createProject(apiBase, name)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectsKey(apiBase) }),
  })
}

/** Deletes a project with its images. */
export function useDeleteProject(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return deleteProject(apiBase, name)
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey(apiBase) }),
        queryClient.invalidateQueries({ queryKey: historyKey(apiBase) }),
      ]),
  })
}

/** Downloads a project's images as `<name>.zip`. */
export function useExportProject(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      downloadBlob(await exportProject(apiBase, name), `${name}.zip`)
    },
    onError: toastError('Could not download the project'),
  })
}

/** Deletes one generated image by its URL; the history drops it at once, not on its next fetch. */
export function useDeleteAsset(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return deleteAsset(apiBase, assetPath(url))
    },
    onSuccess: (_, url) =>
      queryClient.setQueryData<string[]>(historyKey(apiBase), (urls) =>
        urls?.filter((u) => u !== url),
      ),
  })
}
