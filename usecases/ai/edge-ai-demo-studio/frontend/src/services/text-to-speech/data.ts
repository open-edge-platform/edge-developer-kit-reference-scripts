// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Volume2 } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { ttsConfig } from './config'

export const service: ServiceMeta = {
  id: 'text-to-speech',
  name: 'Text to Speech',
  description:
    'Natural-sounding speech synthesis with multiple voice options powered by Kokoro TTS.',
  longDescription:
    'Neural text-to-speech engine producing natural, expressive speech. Supports Kokoro (English, OpenVINO) and Malaya (Malay, VITS) models with multiple voices, adjustable speed, streaming audio output, and multiple audio formats.',
  icon: Volume2,
  port: 8019,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'kokoro',
    device: 'CPU',
  },
  config: ttsConfig,
  logSources: [
    { type: 'service', label: 'text-to-speech', target: 'text-to-speech' },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => {
    const args = [
      '--port',
      String(doc.port),
      '--device',
      doc.models?.default?.device || 'CPU',
    ]
    const source = doc.models?.default?.source
    if (source) {
      args.push('--source', source)
    }
    return args
  },
  workerSubDir: (doc: PayloadService) => {
    const model = doc.models?.default?.name || 'kokoro'
    return `text-to-speech/${model}`
  },
  modelDirectories: ['models/tts'],
}
