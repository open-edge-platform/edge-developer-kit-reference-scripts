// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

// NPU is omitted: the NPU compiler cannot fit RIFE's GridSample warp in CMX at
// full-frame resolutions, so interpolation hangs at compile time on real inputs.
const FRAME_GENERATION_DEVICES = ['CPU', 'GPU']

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: [
    {
      value: 'RIFE',
      label: 'RIFE',
      availableDevices: FRAME_GENERATION_DEVICES,
      backend: 'openvino',
    },
  ],
  availableDevices: FRAME_GENERATION_DEVICES,
  availableModelSources: [{ value: 'huggingface', label: 'Hugging Face' }],
}
