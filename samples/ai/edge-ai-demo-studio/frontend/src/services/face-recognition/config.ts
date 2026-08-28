// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const OPENVINO_DEVICES = ['CPU', 'GPU']

export const serviceConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'omz-retail',
      label:
        'OMZ face-detection-retail-0004 + landmarks-0009 + reid-0095, 256-d',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
    {
      value: 'omz-adas',
      label: 'OMZ face-detection-adas-0001 + landmarks-0009 + reid-0095, 256-d',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
    {
      value: 'yunet-sface',
      label: 'YuNet + SFace — OpenCV Zoo, 128-d (OpenVINO)',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
  ],
  availableDevices: OPENVINO_DEVICES,
  // Models are fixed registry presets, not arbitrary model IDs, so the
  // "Custom model" input in the configure panel is disabled.
  supportsCustomModel: false,
}
