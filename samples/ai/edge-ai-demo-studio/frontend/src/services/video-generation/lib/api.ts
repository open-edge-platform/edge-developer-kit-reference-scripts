// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fetchJson } from '@/lib/browser/fetch-json'
import type { CANCELLED } from '@/lib/browser/sse'

/** A video's status: OpenAI's Video object plus the worker's progress fields. */
export interface VideoStatus {
  id: string
  object: 'video'
  model: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | typeof CANCELLED
  /** 0-100, from the phase and, while denoising, the steps done. */
  progress: number
  created_at: number
  completed_at: number | null
  size: string
  seconds: string
  prompt: string | null
  error: { code: string; message: string } | null
  /** `prepare` (compiling for a new size), `text`, `denoise`, `decode`, `encode`; the status once final. */
  phase: string
  /** Steps done and asked for, while denoising. */
  step: number | null
  steps: number | null
  num_frames: number
  fps: number
  seed: number | null
  image_to_video: boolean
  /** VACE: the video followed a driving video's poses (`content?variant=control`). */
  pose_to_video?: boolean
  /**
   * Asked with `preview`: steps 1 to `previews` have a small MP4 of the model's guess at the video
   * after that step (`content?variant=preview&step=n`). Every step but the last gets one.
   */
  previews?: number
  /** Place in the worker's queue while `queued`; 1 is next. */
  position?: number | null
  /** Seconds since the video started (or was queued). */
  elapsed_time: number
  /** Seconds left, from this instance's own measurements; null before it has any. */
  estimated_time?: number | null
  cancel_requested?: boolean
  /** Once completed: time, steps and frames, for Live metrics. */
  perf?: unknown
}

export interface VideoRequest {
  model: string
  prompt: string
  negative_prompt?: string
  size: string
  num_frames: number
  num_inference_steps?: number
  guidance_scale?: number
  /** The first frame (image-to-video), or with VACE the subject to show. */
  image?: File | null
  /** VACE: the video whose poses the result follows. */
  drivingVideo?: File | null
  /** Also make a small preview of each denoising step. */
  preview?: boolean
}

/** Base URL of a video's status, events and content. */
export function videoUrl(apiBase: string, id: string) {
  return `${apiBase}/v1/videos/${encodeURIComponent(id)}`
}

/** `POST /v1/videos` as multipart, as the OpenAI SDK sends it; answers with the queued video. */
export function startVideo(
  apiBase: string,
  request: VideoRequest,
): Promise<VideoStatus> {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  form.append('size', request.size)
  form.append('num_frames', String(request.num_frames))
  if (request.negative_prompt)
    form.append('negative_prompt', request.negative_prompt)
  if (request.num_inference_steps != null)
    form.append('num_inference_steps', String(request.num_inference_steps))
  if (request.guidance_scale != null)
    form.append('guidance_scale', String(request.guidance_scale))
  if (request.image) form.append('input_reference', request.image)
  if (request.drivingVideo) form.append('input_video', request.drivingVideo)
  if (request.preview) form.append('preview', 'true')
  return fetchJson(`${apiBase}/v1/videos`, {
    method: 'POST',
    body: form,
    errorMessage: 'Video generation failed',
  })
}
