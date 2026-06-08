// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Image } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'image-generation',
  name: 'Image Generation',
  description:
    'Generate images from text prompts using diffusion models accelerated with OpenVINO.',
  longDescription:
    'AI image generation using Stable Diffusion models accelerated with OpenVINO Model Server. Supports text-to-image and image-to-image generation via an OpenAI-compatible API. Configurable inference steps, guidance scale, and resolution.',
  icon: Image,
  port: 8018,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'image-generation', target: 'image-generation' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const args = [
      '--model-id',
      doc.models.default.name,
      '--port',
      String(doc.port),
      '--device',
      doc.models.default.device,
    ]
    if (doc.models.default.source) {
      args.push('--source', doc.models.default.source)
    }
    return args
  },
  workerSubDir: 'image-generation',
  modelDirectories: ['models/ovms', 'models/huggingface'],
}
