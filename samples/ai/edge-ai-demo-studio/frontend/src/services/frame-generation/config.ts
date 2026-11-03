// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

// No NPU (and AUTO never picks it): the NPU compiler cannot fit RIFE's GridSample warp in CMX at
// full-frame resolutions, so compilation hangs on real inputs.
const FRAME_GENERATION_DEVICES = ['AUTO', 'CPU', 'GPU']

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: [
    {
      value: 'RIFE',
      label: 'RIFE',
      availableDevices: FRAME_GENERATION_DEVICES,
      // Converted from PyTorch with compress_to_fp16.
      availableWeightFormats: ['fp16'],
      backend: 'openvino',
    },
  ],
  availableDevices: FRAME_GENERATION_DEVICES,
  availableModelSources: [{ value: 'huggingface', label: 'Hugging Face' }],
}
