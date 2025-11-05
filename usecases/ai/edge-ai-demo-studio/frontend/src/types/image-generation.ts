// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size?: string
  n?: number
  // extra
  prompt_2?: string
  prompt_3?: string
  negative_prompt?: string
  negative_prompt_2?: string
  negative_prompt_3?: string
  num_inference_steps?: number
  guidance_scale?: number
  rng_seed?: number
  max_sequence_length?: number
  is_polling?: boolean
}

export interface ImageEditRequest {
  model: string
  image: File | string
  prompt: string
  size?: string
  n?: number
  // extra
  prompt_2?: string
  prompt_3?: string
  negative_prompt?: string
  negative_prompt_2?: string
  negative_prompt_3?: string
  num_inference_steps?: number
  guidance_scale?: number
  rng_seed?: number
  max_sequence_length?: number
  strength?: number
  is_polling?: boolean
}

export interface ImageGenerationResponse {
  data: Array<{
    b64_json?: string
  }>
}

export interface ImageGenerationError {
  error: {
    message: string
    type: string
    param?: string
    code?: string
  }
}
