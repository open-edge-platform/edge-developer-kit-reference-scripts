// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { IMAGE_GENERATION_PORT } from '@/lib/constants'
import { CreateWorkload, Model } from '@/types/workload'

export const IMAGE_GENERATION_TYPE = 'image-generation' as const

export const IMAGE_GENERATION_DESCRIPTION =
  'Generate images from text prompts using advanced diffusion models.'

export const IMAGE_GENERATION_MODELS: Model[] = [
  {
    name: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    device: 'CPU',
  },
]

export const IMAGE_GENERATION_URL = '/api/image-generation'

export const IMAGE_GENERATION_WORKLOAD: CreateWorkload = {
  name: IMAGE_GENERATION_TYPE,
  type: IMAGE_GENERATION_TYPE,
  models: { default: IMAGE_GENERATION_MODELS[0] },
  port: IMAGE_GENERATION_PORT,
  healthCheck: { url: '/v1/config' },
  engine: 'custom' as const,
}
