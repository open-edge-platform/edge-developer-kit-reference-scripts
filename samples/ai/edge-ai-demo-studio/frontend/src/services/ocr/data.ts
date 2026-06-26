// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ScanText } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

// `ocr` is multi-backend: each engine lives in workers/ocr/<backend> and the
// active one is derived from the selected model key (PaddleOCR today; a
// `tesseract-*` key would route to workers/ocr/tesseract in future).
type OcrBackend = 'paddleocr' | 'tesseract'

const DEFAULT_MODEL = 'ppocrv5'
const DEFAULT_DEVICE = 'CPU'

function backendForModel(modelName: string | undefined): OcrBackend {
  return modelName?.startsWith('tesseract') ? 'tesseract' : 'paddleocr'
}

export const service: ServiceMeta = {
  id: 'ocr',
  name: 'OCR',
  description:
    'Optical character recognition — extract text and its location from images using OCR models on OpenVINO.',
  longDescription:
    'Optical Character Recognition service running PP-OCR detection + recognition pipelines and the PaddleOCR-VL vision-language model on OpenVINO. Detects text regions, returns recognised text with per-region bounding boxes and confidence, and is structured to host additional OCR engines (e.g. Tesseract) under workers/ocr. Accepts single images, client-pushed camera frames over WebSocket, and a server-side camera stream.',
  icon: ScanText,
  port: 8029,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_MODEL,
    device: DEFAULT_DEVICE,
  },
  config: serviceConfig,
  logSources: [{ type: 'service', label: 'ocr', target: 'ocr' }],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  modelDirectories: ['models/ocr', 'models/huggingface', 'models/modelscope'],
  workerSubDir: (doc: PayloadService) =>
    `ocr/${backendForModel(doc.models?.default?.name)}`,
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name ?? DEFAULT_MODEL
    const device = doc.models?.default?.device ?? DEFAULT_DEVICE
    return ['--port', String(doc.port), '--model', model, '--device', device]
  },
}
