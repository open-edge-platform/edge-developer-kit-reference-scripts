// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelOption, ServiceConfig } from '@/services/types'

const OPENVINO_DEVICES = ['AUTO', 'CPU', 'GPU', 'NPU']

/**
 * PP-OCR: detection plus a one-language recogniser, so a language is picked per request. VL: a
 * vision-language model that reads the script off the page and takes a task instead.
 */
interface OcrModelOption extends ModelOption {
  kind: 'pp-ocr' | 'vl'
}

const OCR_MODELS: OcrModelOption[] = [
  {
    value: 'ppocrv5',
    kind: 'pp-ocr',
    availableWeightFormats: ['fp32'],
    label: 'PP-OCRv5 Mobile — fast detect + recognise (ONNX)',
    backend: 'openvino',
    availableDevices: OPENVINO_DEVICES,
  },
  {
    value: 'ppocrv5-server',
    kind: 'pp-ocr',
    availableWeightFormats: ['fp32'],
    label: 'PP-OCRv5 Server — higher accuracy, heavier (ONNX)',
    backend: 'openvino',
    availableDevices: OPENVINO_DEVICES,
  },
  {
    value: 'ppocrv3',
    kind: 'pp-ocr',
    availableWeightFormats: ['fp32'],
    label: 'PP-OCRv3 — classic OpenVINO notebook model (Paddle)',
    backend: 'openvino',
    availableDevices: OPENVINO_DEVICES,
  },
  {
    value: 'paddleocr-vl',
    kind: 'vl',
    label: 'PaddleOCR-VL — layout-aware vision-language OCR',
    backend: 'openvino',
    availableDevices: ['AUTO', 'CPU', 'GPU'],
  },
  {
    value: 'paddleocr-vl-1.5',
    kind: 'vl',
    label: 'PaddleOCR-VL-1.5 — 0.9B VLM, layout-aware OCR',
    backend: 'openvino',
    availableDevices: ['AUTO', 'CPU', 'GPU'],
  },
]

export const serviceConfig: ServiceConfig = {
  availableModels: OCR_MODELS,
  availableDevices: OPENVINO_DEVICES,
  // PaddleOCR-VL's language model is compressed to this on its first-start conversion (fp16 is
  // uncompressed). The PP-OCR presets run their FP32 graphs as they ship.
  availableWeightFormats: ['fp16', 'int8', 'int4'],
  defaultWeightFormat: 'int8',
  // OCR models are fixed registry presets, not arbitrary model IDs.
  supportsCustomModel: false,
}

/** What the selected OCR model reads and returns, for the demo to state. */
export interface OcrModelSummary {
  /** The preset's label, or the model id when it is not a preset. */
  label: string
  kind: OcrModelOption['kind']
  capabilities: string
}

export function describeOcrModel(model: string): OcrModelSummary {
  const preset = OCR_MODELS.find((m) => m.value === model)
  const kind = preset?.kind ?? 'pp-ocr'
  return {
    label: preset?.label ?? model,
    kind,
    capabilities:
      kind === 'vl'
        ? 'Reads whole pages with their layout and can also recognize tables, formulas and charts (pick a task). It detects the language itself; its text may come without positions on the image.'
        : 'Finds each line of text with its position and a confidence score. It reads one script at a time: pick the language of the image.',
  }
}
