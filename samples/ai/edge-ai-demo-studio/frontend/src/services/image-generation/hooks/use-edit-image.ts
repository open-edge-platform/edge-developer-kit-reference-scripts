// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

interface EditImageRequest {
  model: string
  prompt: string
  image: File
  size?: string
  n?: number
  num_inference_steps?: number
  guidance_scale?: number
  strength?: number
  negative_prompt?: string
  rng_seed?: number
}

interface ImageResponseData {
  b64_json?: string
  revised_prompt?: string
}

interface EditImageResponse {
  created: number
  data: ImageResponseData[]
}

async function editImage(
  request: EditImageRequest,
): Promise<EditImageResponse> {
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

  const response = await fetch('/api/image-generation/v3/images/edits', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Image editing failed (${response.status}): ${errorBody}`)
  }

  return response.json()
}

export function useEditImage() {
  return useMutation({
    mutationFn: editImage,
  })
}
