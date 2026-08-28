// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

const API_BASE = '/api/frame-generation'

function resultVideoUrl(taskId: string) {
  return `${API_BASE}/v1/frame-generation/video/${taskId}`
}

export type InterpolationMode = 'fps' | 'slowmo'

export interface VideoTaskStatus {
  status: 'queued' | 'running' | 'finished' | 'error' | 'not_found'
  progress?: number
  position?: number
  mode?: InterpolationMode
  multiplier?: number
  input_fps?: number
  output_fps?: number
  frames?: number
  detail?: string
}

const TERMINAL_TASK_STATUSES = ['finished', 'error', 'not_found']

export function useInterpolateVideo() {
  return useMutation({
    mutationFn: async (params: {
      videoFile: File
      multiplier: number
      mode: InterpolationMode
    }): Promise<{ taskId: string }> => {
      const formData = new FormData()
      formData.append('video', params.videoFile)
      formData.append('multiplier', String(params.multiplier))
      formData.append('mode', params.mode)

      const url = new URL(
        `${API_BASE}/v1/frame-generation/video`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useVideoTaskStatus(taskId: string | null) {
  return useQuery<VideoTaskStatus>({
    queryKey: ['frame-generation', 'task', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/v1/tasks/${taskId}`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_TASK_STATUSES.includes(status) ? false : 1500
    },
  })
}

/**
 * Download a finished task's video as a Blob. Playing from a local blob
 * instead of streaming through the dev proxy keeps previews working when
 * the UI is accessed from another machine, and lets download reuse the
 * same bytes.
 */
export function useResultVideo(taskId: string | null, enabled: boolean) {
  return useQuery<Blob>({
    queryKey: ['frame-generation', 'result', taskId],
    enabled: !!taskId && enabled,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const url = new URL(
        resultVideoUrl(taskId as string),
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.blob()
    },
  })
}
