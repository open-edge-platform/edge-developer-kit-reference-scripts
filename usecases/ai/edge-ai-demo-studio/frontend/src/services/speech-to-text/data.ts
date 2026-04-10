// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Mic } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'speech-to-text',
  name: 'Speech to Text',
  description:
    'Real-time speech recognition with low-latency transcription using Whisper models optimized for Intel hardware.',
  longDescription:
    'Automatic speech recognition service using Whisper models optimized with OpenVINO. Supports 99+ languages, batch transcription, audio denoising, and translation to English.',
  icon: Mic,
  port: 8022,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'openai/whisper-tiny',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [
    { type: 'service', label: 'speech-to-text', target: 'speech-to-text' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const args = [
      '--stt-model-id',
      doc.models?.default?.name ?? 'openai/whisper-tiny',
      '--stt-device',
      doc.models?.default?.device ?? 'CPU',
      '--denoise-model-id',
      doc.models?.denoise?.name ?? 'noise-suppression-poconetlike-0001',
      '--denoise-device',
      doc.models?.denoise?.device ?? doc.models?.default?.device ?? 'CPU',
      '--port',
      String(doc.port),
      '--source',
      doc.models?.default?.source || 'huggingface',
    ]
    return args
  },
  workerSubDir: 'speech-to-text',
  modelDirectories: ['models/stt', 'models/huggingface'],
}
