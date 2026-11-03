// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { toastError } from '@/lib/browser/toast-error'
import {
  classifyImage,
  type FeedbackRequest,
  fetchHealth,
  fetchProjects,
  type GetiConnection,
  type GetiHealth,
  SERVICE_NAME,
  submitFeedback,
  toggleAutoSync,
} from '../lib/api'
import { toClassificationResult } from '../lib/classification'

export const healthKey = (apiBase: string | undefined) =>
  ['geti-classifier', 'health', apiBase] as const

/** The worker's pipeline state; a failed read is retried as the worker may still be starting. */
export function useGetiHealth(apiBase: string | undefined, enabled = true) {
  return useQuery({
    queryKey: healthKey(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchHealth(apiBase)
    },
    enabled: enabled && Boolean(apiBase),
    retry: 5,
    retryDelay: 2000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })
}

/** Background model sync, read from the worker's health; a switch updates the cached health. */
export function useAutoSync(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  const { data: health } = useGetiHealth(apiBase)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return toggleAutoSync(apiBase, enabled)
    },
    onSuccess: ({ enabled }) => {
      queryClient.setQueryData<GetiHealth>(healthKey(apiBase), (current) =>
        current ? { ...current, auto_sync_enabled: enabled } : current,
      )
      return queryClient.invalidateQueries({ queryKey: healthKey(apiBase) })
    },
    onError: toastError('Could not switch auto-sync'),
  })

  return {
    // While a switch is on its way, show where it is going.
    enabled: toggle.isPending
      ? toggle.variables
      : (health?.auto_sync_enabled ?? false),
    /** Unknown until the worker's health is read. */
    known: health !== undefined,
    isPending: toggle.isPending,
    setEnabled: (enabled: boolean) => toggle.mutate(enabled),
  }
}

/** Lists the Geti server's projects: how the wizard connects. */
export function useGetiProjects(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (connection: GetiConnection) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchProjects(apiBase, connection)
    },
  })
}

/** Segments, masks and classifies an image. */
export function useClassify(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async (file: File) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return toClassificationResult(apiBase, await classifyImage(apiBase, file))
    },
  })
}

/** Sends a confirmed or corrected label to Geti for retraining. */
export function useFeedback(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (request: FeedbackRequest) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return submitFeedback(apiBase, request)
    },
  })
}
