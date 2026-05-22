// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Users } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'diarization',
  name: 'Speaker Diarization',
  description:
    'Identify and label speakers in audio recordings using pyannote.audio speaker diarization models.',
  longDescription:
    'Speaker diarization service using pyannote.audio to detect and segment speakers in audio recordings. Supports voice enrollment for named speaker identification, cosine-similarity matching, and multi-speaker timeline generation.',
  icon: Users,
  port: 8025,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'pyannote/speaker-diarization-3.1',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'diarization', target: 'diarization' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

const VALID_SOURCES = new Set(['huggingface', 'modelscope'])

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const rawSource = doc.models?.default?.source
    const source =
      rawSource && VALID_SOURCES.has(rawSource) ? rawSource : 'huggingface'
    const args = [
      '--port',
      String(doc.port),
      '--device',
      doc.models?.default?.device ?? 'CPU',
      '--source',
      source,
    ]
    return args
  },
  workerSubDir: 'diarization',
  modelDirectories: ['models/huggingface', 'models/modelscope'],
}
