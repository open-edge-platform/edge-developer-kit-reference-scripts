// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const STT_DEVICES = ['CPU', 'GPU', 'NPU']

export const serviceConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'openai/whisper-large-v3-turbo',
      label: 'Whisper Large v3 Turbo',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'openai/whisper-large-v3',
      label: 'Whisper Large v3',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'openai/whisper-medium',
      label: 'Whisper Medium',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'openai/whisper-small',
      label: 'Whisper Small',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'openai/whisper-tiny',
      label: 'Whisper Tiny',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
    {
      value: 'openai/whisper-base',
      label: 'Whisper Base',
      availableDevices: STT_DEVICES,
      backend: 'openvino',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    // { value: 'modelscope', label: 'ModelScope' },
  ],
}
