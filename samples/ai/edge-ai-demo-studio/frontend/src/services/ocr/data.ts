// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ScanText } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { describeOcrModel, serviceConfig } from './config'

// Each engine lives in workers/services/ocr/<backend>, picked from the model key.
type OcrBackend = 'paddleocr' | 'tesseract'

const DEFAULT_MODEL = 'ppocrv5'
const DEFAULT_DEVICE = 'AUTO'

function backendForModel(modelName: string | undefined): OcrBackend {
  return modelName?.startsWith('tesseract') ? 'tesseract' : 'paddleocr'
}

export const service: ServiceMeta = {
  id: 'ocr',
  name: 'OCR',
  multiInstance: true,
  description:
    'Optical character recognition — extract text and its location from images using OCR models on OpenVINO.',
  longDescription:
    'Optical Character Recognition service running PP-OCR detection + recognition pipelines and the PaddleOCR-VL vision-language model on OpenVINO. Detects text regions, returns recognised text with per-region bounding boxes and confidence, and is structured to host additional OCR engines (e.g. Tesseract) under workers/services/ocr. Accepts single images, client-pushed camera frames over WebSocket, and a server-side camera stream.',
  icon: ScanText,
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
  modelCatalog: 'script',
  // Its Hugging Face downloads go to plain folders under models/ocr, not the
  // shared Hugging Face cache.
  modelDirectories: ['models/ocr', 'models/modelscope'],
  workerSubDir: (doc: PayloadService) =>
    `services/ocr/${backendForModel(doc.models?.default?.name)}`,
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name ?? DEFAULT_MODEL
    const device = doc.models?.default?.device ?? DEFAULT_DEVICE
    const precision =
      describeOcrModel(model).kind === 'vl'
        ? getEffectivePrecision(serviceConfig, doc.models?.default?.quant)
        : undefined
    return [
      '--port',
      String(doc.port),
      '--model',
      model,
      '--device',
      device,
      ...(precision ? ['--precision', precision] : []),
    ]
  },
}
