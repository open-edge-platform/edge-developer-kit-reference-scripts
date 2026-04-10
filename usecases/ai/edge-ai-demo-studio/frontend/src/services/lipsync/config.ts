// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: [
    {
      value: 'Wav2Lip',
      label: 'Wav2Lip',
      availableDevices: ['cpu', 'xpu'],
      backend: 'pytorch',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
}
