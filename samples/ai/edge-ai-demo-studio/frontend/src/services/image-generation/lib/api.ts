// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fetchJson, postJson } from '@/lib/browser/fetch-json'

/** What a request started with `is_polling` answers with. */
export interface ImageJobStarted {
  job_id: string
}

/** Settings a generation and an edit share. */
interface ImageRequestBase {
  model: string
  prompt: string
  size?: string
  n?: number
  num_inference_steps?: number
  guidance_scale?: number
  negative_prompt?: string
  rng_seed?: number
}

export type GenerateImageRequest = ImageRequestBase

export interface EditImageRequest extends ImageRequestBase {
  image: File
  strength?: number
}

/** Base URL of a job's status, events and images. */
export function imageJobUrl(apiBase: string, jobId: string) {
  return `${apiBase}/v1/images/jobs/${encodeURIComponent(jobId)}`
}

export function startGenerateJob(
  apiBase: string,
  request: GenerateImageRequest,
): Promise<ImageJobStarted> {
  return postJson(
    `${apiBase}/v1/images/generations`,
    { ...request, is_polling: true },
    { errorMessage: 'Image generation failed' },
  )
}

export function startEditJob(
  apiBase: string,
  request: EditImageRequest,
): Promise<ImageJobStarted> {
  const formData = new FormData()
  formData.append('model', request.model)
  formData.append('prompt', request.prompt)
  formData.append('image', request.image)
  if (request.size) formData.append('size', request.size)
  if (request.n != null) formData.append('n', String(request.n))
  if (request.num_inference_steps != null)
    formData.append('num_inference_steps', String(request.num_inference_steps))
  if (request.guidance_scale != null)
    formData.append('guidance_scale', String(request.guidance_scale))
  if (request.strength != null)
    formData.append('strength', String(request.strength))
  if (request.negative_prompt)
    formData.append('negative_prompt', request.negative_prompt)
  if (request.rng_seed != null)
    formData.append('rng_seed', String(request.rng_seed))
  formData.append('is_polling', 'true')

  return fetchJson(`${apiBase}/v1/images/edits`, {
    method: 'POST',
    body: formData,
    errorMessage: 'Image editing failed',
  })
}
