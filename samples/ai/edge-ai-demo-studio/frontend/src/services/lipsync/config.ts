// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const LIPSYNC_DEVICES = ['CPU', 'GPU', 'NPU']

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: [
    {
      value: 'Wav2Lip',
      label: 'Wav2Lip',
      availableDevices: LIPSYNC_DEVICES,
      backend: 'openvino',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
}
