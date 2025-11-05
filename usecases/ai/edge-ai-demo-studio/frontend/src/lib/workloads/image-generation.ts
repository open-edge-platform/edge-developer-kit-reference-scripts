// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Model } from '@/components/workloads/text-generation/settings'
import { IMAGE_GENERATION_PORT } from '@/lib/constants'

export const IMAGE_GENERATION_TYPE = 'image-generation' as const

export const IMAGE_GENERATION_DESCRIPTION =
  'Generate images from text prompts using advanced diffusion models.'

export const IMAGE_GENERATION_MODELS: Model[] = [
  {
    name: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    value: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    type: 'predefined',
  },
]

export const IMAGE_GENERATION_WORKLOAD = {
  name: IMAGE_GENERATION_TYPE,
  type: IMAGE_GENERATION_TYPE,
  model: IMAGE_GENERATION_MODELS[0].value,
  device: 'CPU',
  port: IMAGE_GENERATION_PORT,
  healthUrl: '/v1/config',
}
