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

export interface ImageGenerationTaskStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  elapsed_time: number
  estimated_time?: number
  result?: ImageGenerationResponse | string
}

export interface ImageGenerationForm {
  formData: ImageGenerationFormData
  updateField: (
    field: keyof ImageGenerationFormData,
    value: string | number | boolean | null,
  ) => void
  getFormattedSize: () => string
  reset: () => void
}

export interface ImageGenerationFormData {
  prompt: string
  negativePrompt: string
  sizeMode: 'auto' | 'custom'
  customWidth: number
  customHeight: number
  numImages: number
  steps: number
  rngSeed: number
  guidanceScale: number
  showAdvanced: boolean
}

export interface ImageEditFormData extends Omit<
  ImageGenerationFormData,
  'numImages'
> {
  numImages: number
  sourceImage: File | null
  sourceImagePreview: string
}

export interface ImageEditForm {
  formData: ImageEditFormData
  updateField: (
    field: keyof ImageEditFormData,
    value: string | number | boolean | null,
  ) => void
  getFormattedSize: () => string
  handleFileUpload: (file: File) => Promise<string>
  reset: () => void
}
