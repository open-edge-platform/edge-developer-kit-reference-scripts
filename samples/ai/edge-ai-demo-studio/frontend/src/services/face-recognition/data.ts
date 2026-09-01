// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ScanFace } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

const DEFAULT_MODEL = 'omz-retail'
const DEFAULT_DEVICE = 'CPU'

export const service: ServiceMeta = {
  id: 'face-recognition',
  name: 'Face Recognition',
  description:
    'Detect and identify faces against a reference gallery using Open Model Zoo or OpenCV Zoo pipelines.',
  longDescription:
    'Face recognition service with selectable pipelines on OpenVINO. The Open Model Zoo presets follow the face_recognition_demo chain — an SSD face detector (retail-0004 or adas-0001), landmarks-regression-retail-0009 for five-point alignment and face-reidentification-retail-0095 for 256-d descriptors; the OpenCV Zoo preset pairs YuNet detection with SFace 128-d embeddings. Enroll people with one or more reference images, then identify faces in uploads or webcam captures; the gallery is re-embedded automatically when the model is switched.',
  icon: ScanFace,
  port: 8031,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_MODEL,
    device: DEFAULT_DEVICE,
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'face-recognition', target: 'face-recognition' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  modelDirectories: ['models/face-recognition'],
  workerSubDir: 'face-recognition',
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name ?? DEFAULT_MODEL
    const device = doc.models?.default?.device ?? DEFAULT_DEVICE
    return ['--port', String(doc.port), '--model', model, '--device', device]
  },
}
