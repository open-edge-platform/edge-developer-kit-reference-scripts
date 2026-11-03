// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Image } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'image-generation',
  name: 'Image Generation',
  multiInstance: true,
  // Finished images and drafts stay readable while the instance is stopped.
  keepDemoWhenStopped: true,
  /** The worker runs its own OVMS on base port + 1. */
  portBlock: 2,
  description:
    'Generate images from text prompts using diffusion models accelerated with OpenVINO.',
  longDescription:
    'AI image generation using Stable Diffusion models accelerated with OpenVINO Model Server. Supports text-to-image and image-to-image generation via an OpenAI-compatible API. Configurable inference steps, guidance scale, and resolution.',
  icon: Image,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    device: 'AUTO',
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
  modelCatalog: 'script',
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
    // Pre-converted IR ignores the precision.
    const precision = getEffectivePrecision(
      serviceConfig,
      doc.models.default.quant,
    )
    if (precision) {
      args.push('--precision', precision)
    }
    return args
  },
  workerSubDir: 'services/image-generation',
  // Conversions at other precisions than int8 go under
  // models/ovms/precision-<precision>.
  modelDirectories: ['models/ovms', 'models/huggingface'],
}
