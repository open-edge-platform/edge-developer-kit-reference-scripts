// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const LIPSYNC_DEVICES = ['AUTO', 'CPU', 'GPU', 'NPU']

export const serviceConfig: ServiceConfig = {
  supportsCustomModel: false,
  // Wav2Lip: FP16, or INT8 quantized with NNCF on first start. Auto lets the worker pick INT8 on
  // CPU, NPU and iGPUs (FP16 can't sustain 25 fps there), FP16 elsewhere. MuseTalk is FP16 only.
  availableWeightFormats: ['auto', 'fp16', 'int8'],
  defaultWeightFormat: 'auto',
  availableModels: [
    {
      value: 'Wav2Lip',
      label: 'Wav2Lip',
      availableDevices: LIPSYNC_DEVICES,
      backend: 'openvino',
      weight: 'lightweight',
    },
    {
      value: 'MuseTalk',
      label: 'MuseTalk',
      availableDevices: LIPSYNC_DEVICES,
      availableWeightFormats: ['fp16'],
      backend: 'openvino',
      weight: 'heavy',
    },
  ],
  availableModelSources: [
    { value: 'huggingface', label: 'Hugging Face' },
    { value: 'modelscope', label: 'ModelScope' },
  ],
}
