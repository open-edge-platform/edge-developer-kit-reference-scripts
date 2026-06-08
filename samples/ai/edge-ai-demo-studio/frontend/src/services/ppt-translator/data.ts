// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'ppt-translator',
  name: 'PPT Translator',
  description:
    'Translates PowerPoint presentations while preserving formatting using a local LLM.',
  longDescription:
    'A PowerPoint translation pipeline that uses a local large language model to translate presentation slides while preserving all formatting, fonts, and layout. Supports multiple languages, speaker notes translation, proper noun preservation, and automatic font size adjustment.',
  icon: FileText,
  port: 8024,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'ppt-translator',
      target: 'ppt-translator',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'ppt-translator',
}
