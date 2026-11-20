// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sleep } from '@/lib/async'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, fetchOk } from '@/lib/browser/fetch-json'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { type JobDefinition, jobFailure } from '@/services/common/jobs/job-run'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import { serverTimingMs, startWork } from '@/services/common/metrics/work'
import type { Service } from '@/services/types'

// Types mirror workers/services/image-upscaling/main.py.

export type UpscaleKind = 'image' | 'video'
export type ImageFormat = 'png' | 'webp' | 'jpeg'

export interface UpscaleTaskStatus {
  status:
    'queued' | 'running' | 'finished' | 'error' | 'cancelled' | 'not_found'
  kind?: UpscaleKind
  progress?: number
  position?: number
  /** Image, while running: tiles the model has finished, of all. */
  tiles_done?: number
  tiles_total?: number
  /** Image, while running on SeedVR2 (no tiles): the phase it is in, e.g. "Restoring". */
  stage?: string
  /** Video, while running: frames written so far, of the (estimated) total. */
  frames_done?: number
  frames_total?: number
  /** While running: a cancel was asked for; it stops at its next tile or frame. */
  cancel_requested?: boolean
  format?: ImageFormat
  input_width?: number
  input_height?: number
  output_width?: number
  output_height?: number
  /** Output pixels in all (every frame, for a video), in millions. */
  megapixels?: number
  frames?: number
  fps?: number
  detail?: string
  /** Once finished: the work and the time it took, for Live metrics. */
  perf?: { seconds?: number }
}

export interface UpscaleRequest {
  file: File
  /** Times the input size; at most the model's own scale. */
  outscale: number
  /** Images only. */
  format?: ImageFormat
}

/**
 * Worker background task: `POST /v1/image-upscaling/{kind}` returns a `taskId`, followed via
 * `/v1/tasks/{taskId}/events` and cancelled with `DELETE /v1/tasks/{taskId}`.
 */
function upscaleJob(
  apiBase: string | undefined,
  kind: UpscaleKind,
): JobDefinition<UpscaleRequest, UpscaleTaskStatus, UpscaleTaskStatus> {
  return {
    // Not aborted with the run: a cut-off upload may still start a task whose id never comes back.
    // `JobRun` cancels the task once the id arrives instead.
    submit: async ({ file, outscale, format }) => {
      requireApiBase(apiBase, 'Image Upscaling')
      const formData = new FormData()
      formData.append(kind, file)
      formData.append('outscale', String(outscale))
      if (format) formData.append('format', format)
      const { taskId } = await fetchJson<{ taskId: string }>(
        `${apiBase}/v1/image-upscaling/${kind}`,
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
            ? 'The upscaling task was not found'
            : 'unknown error',
        )
      }
      return status
    },
    metricsApiBase: apiBase,
    followErrorMessage: 'Unable to check upscaling status',
  }
}

/**
 * One task of each kind at a time, kept per instance for the page visit. Starting another,
 * `reset` or leaving the page cancels the running one, since nothing else could pick its result up.
 */
export function useUpscaleJob(service: Service, kind: UpscaleKind) {
  return useJobRun(upscaleJob(service.apiBase, kind), {
    sessionKey: demoStateKey(service, `image-upscaling:${kind}-job`),
  })
}

/**
 * A finished task's image or video as a Blob: unlike streaming through the dev proxy, it shows
 * when the UI is opened from another machine, and Download reuses the bytes.
 */
export function useUpscaleResult(
  kind: UpscaleKind,
  taskId: string | null,
  apiBase: string | undefined,
) {
  return useQuery<Blob>({
    queryKey: ['image-upscaling', 'result', kind, apiBase, taskId],
    enabled: !!taskId && Boolean(apiBase),
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const res = await fetchOk(
        `${apiBase}/v1/image-upscaling/${kind}/${encodeURIComponent(taskId ?? '')}`,
      )
      return res.blob()
    },
  })
}

export interface LiveStats {
  /** Upscaled frames per second over the last few. */
  fps: number
  /** The latest frame's round trip, capture to decoded reply. */
  latencyMs: number
  /** The latest frame's model time, as the worker reports it. */
  inferenceMs?: number
  inputWidth: number
  inputHeight: number
  outputWidth: number
  outputHeight: number
}

export interface LiveFrames {
  /** The frame sent, as the model saw it. */
  input: string
  /** The model's answer. */
  output: string
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No frame'))),
      'image/jpeg',
      0.92,
    ),
  )
}

const FPS_WINDOW = 10

/**
 * Upscales the webcam continuously: one frame in flight, each scaled down to `inputWidth` before
 * it is sent (the model's input size is what decides its speed), the next sent once the reply is
 * shown. Stops itself on an error, which it reports.
 */
export function useLiveUpscale({
  apiBase,
  video,
  inputWidth,
  outscale,
}: {
  apiBase: string | undefined
  video: () => HTMLVideoElement | null
  inputWidth: number
  outscale: number
}) {
  const [running, setRunning] = useState(false)
  const [frames, setFrames] = useState<LiveFrames | null>(null)
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The URLs on screen, revoked once replaced or on unmount.
  const shown = useRef<LiveFrames | null>(null)

  const show = useCallback((next: LiveFrames | null) => {
    const previous = shown.current
    shown.current = next
    setFrames(next)
    if (previous) {
      URL.revokeObjectURL(previous.input)
      URL.revokeObjectURL(previous.output)
    }
  }, [])

  useEffect(() => () => show(null), [show])

  useEffect(() => {
    if (!running || !apiBase) return
    const controller = new AbortController()
    const canvas = document.createElement('canvas')
    const sentAt: number[] = []

    const step = async () => {
      while (!controller.signal.aborted) {
        const node = video()
        const ctx = canvas.getContext('2d')
        if (!node || !node.videoWidth || !ctx) {
          await sleep(100)
          continue
        }
        // Even sizes: an odd one would round differently in the worker's output.
        const width = Math.min(inputWidth, node.videoWidth) & ~1
        const height =
          Math.round((node.videoHeight * width) / node.videoWidth) & ~1
        canvas.width = width
        canvas.height = height
        ctx.drawImage(node, 0, 0, width, height)
        const started = performance.now()
        const work = startWork(apiBase)
        try {
          const input = await canvasToBlob(canvas)
          const res = await fetchOk(
            `${apiBase}/v1/image-upscaling/frame?outscale=${outscale}&format=jpeg`,
            { method: 'POST', body: input, signal: controller.signal },
          )
          const output = await res.blob()
          const outputWidth = Number(res.headers.get('x-image-width'))
          const outputHeight = Number(res.headers.get('x-image-height'))
          const inferenceMs = serverTimingMs(res.headers)
          work.finish({
            inferenceMs,
            quantities: { items: (outputWidth * outputHeight) / 1e6 },
          })
          if (controller.signal.aborted) return
          const now = performance.now()
          sentAt.push(now)
          if (sentAt.length > FPS_WINDOW) sentAt.shift()
          show({
            input: URL.createObjectURL(input),
            output: URL.createObjectURL(output),
          })
          setStats({
            fps:
              sentAt.length > 1
                ? ((sentAt.length - 1) * 1000) / (now - sentAt[0])
                : 1000 / (now - started),
            latencyMs: now - started,
            inferenceMs,
            inputWidth: width,
            inputHeight: height,
            outputWidth,
            outputHeight,
          })
        } catch (err) {
          work.settleError(controller.signal)
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : String(err))
          setRunning(false)
          return
        }
      }
    }
    step()
    return () => controller.abort()
  }, [running, apiBase, video, inputWidth, outscale, show])

  const start = useCallback(() => {
    setError(null)
    setStats(null)
    setRunning(true)
  }, [])
  const stop = useCallback(() => setRunning(false), [])

  return { running, frames, stats, error, start, stop }
}
