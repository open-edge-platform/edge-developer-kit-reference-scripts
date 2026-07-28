// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/types/common'

const DIARIZATION_DEVICES = ['CPU', 'XPU']

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  availableModels: [
    {
      value: 'pyannote/speaker-diarization-community-1',
      label: 'pyannote Speaker Diarization Community-1',
      availableDevices: DIARIZATION_DEVICES,
      backend: 'pytorch',
      gated: ['huggingface'],
    },
  ],
  availableDevices: DIARIZATION_DEVICES,
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
}
