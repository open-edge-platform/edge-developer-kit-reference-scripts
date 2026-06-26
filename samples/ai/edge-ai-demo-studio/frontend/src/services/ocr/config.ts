// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

const OPENVINO_DEVICES = ['CPU', 'GPU', 'NPU']

export const serviceConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'ppocrv5',
      label: 'PP-OCRv5 Mobile — fast detect + recognise (ONNX)',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
    {
      value: 'ppocrv5-server',
      label: 'PP-OCRv5 Server — higher accuracy, heavier (ONNX)',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
    {
      value: 'ppocrv3',
      label: 'PP-OCRv3 — classic OpenVINO notebook model (Paddle)',
      backend: 'openvino',
      availableDevices: OPENVINO_DEVICES,
    },
    {
      value: 'paddleocr-vl',
      label: 'PaddleOCR-VL — layout-aware vision-language OCR',
      backend: 'openvino',
      availableDevices: ['CPU', 'GPU'],
    },
    {
      value: 'paddleocr-vl-1.5',
      label: 'PaddleOCR-VL-1.5 — 0.9B VLM, layout-aware OCR',
      backend: 'openvino',
      availableDevices: ['CPU', 'GPU'],
    },
  ],
  availableDevices: OPENVINO_DEVICES,
  // OCR models are fixed registry presets, not arbitrary model IDs, so the
  // "Custom model" input in the configure panel is disabled.
  supportsCustomModel: false,
}
