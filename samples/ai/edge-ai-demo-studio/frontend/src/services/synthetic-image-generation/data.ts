// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Image } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'synthetic-image-generation',
  name: 'Synthetic Image Generation',
  description:
    'Generate and edit synthetic images from base images for dataset augmentation.',
  longDescription:
    'A project-based synthetic image generation pipeline for creating training datasets. Upload a base image and generate variations including good samples, missing component scenarios, and custom modifications. Uses diffusion models for high-quality synthetic data generation.',
  icon: Image,
  port: 8021,
  supportedOS: ['linux'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'synthetic-image-generation',
      target: 'synthetic-image-generation',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    return ['--port', String(doc.port)]
  },
  workerSubDir: 'synthetic-image-generation',
}
