// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, fetchOk } from '@/lib/browser/fetch-json'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { type JobDefinition, jobFailure } from '@/services/common/jobs/job-run'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import type { Service } from '@/services/types'

export type InterpolationMode = 'fps' | 'slowmo'

export interface VideoTaskStatus {
  status:
    'queued' | 'running' | 'finished' | 'error' | 'cancelled' | 'not_found'
  progress?: number
  position?: number
  /** While running: output frames written so far. */
  frames_done?: number
  /** While running: the output frames expected in all (an estimate). */
  frames_total?: number
  /** While running: a cancel was asked for; it stops at its next chunk. */
  cancel_requested?: boolean
  mode?: InterpolationMode
  multiplier?: number
  input_fps?: number
  output_fps?: number
  frames?: number
  detail?: string
  /** Once finished: the frames and the time they took, for Live metrics. */
  perf?: unknown
}

export interface InterpolationRequest {
  videoFile: File
  multiplier: number
  mode: InterpolationMode
}

/**
 * Worker background task: `POST /v1/frame-generation/video` returns a `taskId`, followed via
 * `/v1/tasks/{taskId}/events` and cancelled with `DELETE /v1/tasks/{taskId}`.
 */
function interpolationJob(
  apiBase: string | undefined,
): JobDefinition<InterpolationRequest, VideoTaskStatus, VideoTaskStatus> {
  return {
    // Not aborted with the run: a cut-off upload may still start a task whose id never comes back.
    // `JobRun` cancels the task once the id arrives instead.
    submit: async ({ videoFile, multiplier, mode }) => {
      requireApiBase(apiBase, 'Frame Generation')
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('multiplier', String(multiplier))
      formData.append('mode', mode)
      const { taskId } = await fetchJson<{ taskId: string }>(
        `${apiBase}/v1/frame-generation/video`,
        { method: 'POST', body: formData },
      )
      return taskId
    },
    jobUrl: (taskId) => `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`,
    toResult: (status) => {
      if (status.status !== 'finished') {
        throw jobFailure(
          status,
          status.status === 'not_found'
            ? 'The interpolation task was not found'
            : 'unknown error',
        )
      }
      return status
    },
    metricsApiBase: apiBase,
    followErrorMessage: 'Unable to check interpolation status',
  }
}

/**
 * One task at a time, kept per instance for the page visit. Starting another, `reset` or leaving
 * the page cancels the running one, since nothing else could pick its result up.
 */
export function useInterpolationJob(service: Service) {
  return useJobRun(interpolationJob(service.apiBase), {
    sessionKey: demoStateKey(service, 'frame-generation:job'),
  })
}

/**
 * A finished task's video as a Blob: unlike streaming through the dev proxy, this plays when the UI
 * is opened from another machine, and Download reuses the bytes.
 */
export function useResultVideo(
  taskId: string | null,
  enabled: boolean,
  apiBase: string | undefined,
) {
  return useQuery<Blob>({
    queryKey: ['frame-generation', 'result', apiBase, taskId],
    enabled: !!taskId && enabled && Boolean(apiBase),
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const res = await fetchOk(
        `${apiBase}/v1/frame-generation/video/${encodeURIComponent(taskId ?? '')}`,
      )
      return res.blob()
    },
  })
}
