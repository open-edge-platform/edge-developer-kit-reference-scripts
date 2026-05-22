// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const IMAGE_GEN_DEVICES = ['GPU', 'CPU', 'NPU', 'AUTO']

export const serviceConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
      label: 'Stable Diffusion 1.5 (INT8)',
      availableDevices: IMAGE_GEN_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'stabilityai/stable-diffusion-xl',
      label: 'Stable Diffusion XL',
      availableDevices: IMAGE_GEN_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'stabilityai/sdxl-turbo',
      label: 'SDXL Turbo',
      availableDevices: IMAGE_GEN_DEVICES,
      backend: 'openvino',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
}

export const demoConfig = {
  inputPlaceholder: 'Describe the image you want to generate...',
  defaultInput:
    'A futuristic data center with glowing blue Intel processors, digital art style',
}
