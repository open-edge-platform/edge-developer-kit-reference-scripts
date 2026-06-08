// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Sparkles } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'geti-classifier',
  name: 'Geti Image Classifier',
  description:
    'Serves inference from a local Intel Geti deployment and collects feedback for continuous model improvement.',
  longDescription:
    'Loads a local Geti code deployment and exposes image classification inference endpoints. Supports feedback submission to a Geti server for continuous model improvement, automatic model hot-swap when a newer version is trained, and background auto-sync polling.',
  icon: Sparkles,
  port: 8028,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'geti-classifier',
      target: 'geti-classifier',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'geti-classifier',
}
