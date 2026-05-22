// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'medical-scribe-database',
  name: 'Medical Scribe Database',
  description:
    'Manages and stores data for Medical Scribe using a dedicated medical-scribe database.',
  longDescription:
    'A dedicated medical scribe database service that stores and manages data for Medical Scribe. Ensures data integrity, supports concurrent access, and provides efficient querying capabilities.',
  icon: FileText,
  port: 8026,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'medical-scribe-database',
      target: 'medical-scribe-database',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'medical-scribe-database',
}
