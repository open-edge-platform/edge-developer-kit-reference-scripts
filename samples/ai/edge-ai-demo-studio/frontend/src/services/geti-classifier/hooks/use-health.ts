// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GetiHealthResponse {
  status: string
  pipeline_ready: boolean

  // Classification
  cls_configured: boolean
  cls_model_loaded: boolean
  cls_project_name: string | null
  cls_project_id: string | null
  cls_allowed_labels: string[]
  cls_device: string
  cls_model_id: string | null
  cls_model_name: string | null
  cls_model_version: number | null
  cls_model_score: number | null

  // Segmentation
  seg_configured: boolean
  seg_model_loaded: boolean
  seg_project_name: string | null
  seg_project_id: string | null
  seg_device: string
  seg_model_id: string | null
  seg_model_name: string | null
  seg_model_version: number | null
  seg_model_score: number | null

  // Shared
  platform: string
  auto_sync_enabled: boolean
  auto_sync_interval_seconds: number
}

// ── Hook ──────────────────────────────────────────────────────────────────────

type GetiHealthErrorResponse = {
  error?: string
  detail?: string
  status?: string
}
export function useGetiHealth(enabled = true) {
  return useQuery<GetiHealthResponse>({
    queryKey: ['geti-classifier-health'],
    queryFn: async () => {
      const res = await fetch('/api/geti-classifier/healthcheck')
      const data = (await res.json()) as
        GetiHealthResponse | GetiHealthErrorResponse
      return data as GetiHealthResponse
    },
    enabled,
    retry: 5,
    retryDelay: 2000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })
}
