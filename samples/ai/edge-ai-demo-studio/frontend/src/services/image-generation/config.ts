// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const IMAGE_GEN_DEVICES = ['AUTO', 'GPU', 'CPU', 'NPU']

export const serviceConfig: ServiceConfig = {
  // OVMS converts a non-IR model with optimum-cli at this format on first start (`--precision`).
  availableWeightFormats: ['fp32', 'fp16', 'int8', 'int4'],
  defaultWeightFormat: 'int8',
  availableModels: [
    {
      value: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
      label: 'Stable Diffusion 1.5 (INT8)',
      availableDevices: IMAGE_GEN_DEVICES,
      availableWeightFormats: ['int8'],
      backend: 'openvino',
    },
    {
      value: 'stabilityai/stable-diffusion-xl',
      label: 'Stable Diffusion XL',
      availableDevices: IMAGE_GEN_DEVICES,
      backend: 'openvino',
    },
    {
      // Upstream `stabilityai/sdxl-turbo` is 55 GB of safetensors/ONNX that OVMS would clone and
      // convert. This is a 6.2 GB OpenVINO IR export in the layout OpenVINO GenAI accepts (older
      // exports use `OV*` class names it rejects). It ships no OpenVINO tokenizers; the worker
      // converts them after the pull.
      value: 'Aminfri/sdxl-turbo-openvino',
      label: 'SDXL Turbo (OpenVINO)',
      availableDevices: IMAGE_GEN_DEVICES,
      availableWeightFormats: ['int8'],
      backend: 'openvino',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
  // Any OpenVINO GenAI image pipeline on either hub can be typed in.
  supportsCustomModel: true,
}

export const demoConfig = {
  inputPlaceholder: 'Describe the image you want to generate...',
  defaultInput:
    'A futuristic data center with glowing blue Intel processors, digital art style',
}
