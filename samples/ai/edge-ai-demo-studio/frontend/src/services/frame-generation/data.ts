// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Film } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'frame-generation',
  name: 'Frame Generation',
  description:
    'RIFE video frame interpolation: fill in-between frames or upscale video FPS.',
  longDescription:
    'AI-powered frame generation service using the RIFE interpolation model on OpenVINO. Generates intermediate frames between keyframe pairs — used by the Lipsync service to reach the avatar frame rate on slower accelerators — and upscales the frame rate of uploaded videos (2x-4x). The interpolation device (CPU/GPU) is configured on this service.',
  icon: Film,
  port: 8031,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'RIFE',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'frame-generation', target: 'frame-generation' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => [
    '--port',
    String(doc.port),
    '--device',
    doc.models?.default?.device ?? 'CPU',
    '--source',
    doc.models?.default?.source || 'huggingface',
  ],
  workerSubDir: 'frame-generation',
  modelDirectories: ['models/rife'],
}
