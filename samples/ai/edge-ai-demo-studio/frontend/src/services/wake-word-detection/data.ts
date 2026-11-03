// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AudioLines } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'wake-word-detection',
  name: 'Wake Word Detection',
  multiInstance: true,
  description:
    'Detect custom wake words from microphone input and send webhook notifications on detection events.',
  longDescription:
    "Event-driven wake word detection service that monitors the server's microphone for configurable trigger phrases using OpenWakeWord ONNX models. Supports webhook subscriptions for real-time detection notifications, dynamic model management (upload, reload, delete), audio device selection, and tunable VAD thresholds.",
  icon: AudioLines,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'hey_jarvis_v0.1.onnx',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [
    {
      type: 'service',
      label: 'wake-word-detection',
      target: 'wake-word-detection',
    },
  ],
}

export const worker: WorkerConfig = {
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const args = ['--port', String(doc.port)]

    // default.name may hold several comma-separated ONNX filenames.
    const modelName = doc.models?.default?.name
    if (modelName) {
      const models = modelName.split(',').map((m) => m.trim())
      args.push('--models', ...models)
    }

    const vadThreshold = (doc.metadata as { vadThreshold?: number } | undefined)
      ?.vadThreshold
    if (vadThreshold != null) {
      args.push('--vad-threshold', String(vadThreshold))
    }

    // The instance's default input device; the demo can still switch it at runtime.
    const audioDevice = (doc.metadata as { audioDevice?: number } | undefined)
      ?.audioDevice
    if (typeof audioDevice === 'number' && Number.isInteger(audioDevice)) {
      args.push('--audio-device', String(audioDevice))
    }

    return args
  },
  workerSubDir: 'services/wake-word-detection',
  modelDirectories: ['models/wake-word-detection'],
}
