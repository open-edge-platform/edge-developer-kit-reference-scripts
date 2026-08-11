// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Video } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'lipsync',
  name: 'Lipsync',
  description:
    'Real-time avatar lip-syncing with Wav2Lip or MuseTalk, streamed over WebRTC.',
  longDescription:
    'AI-powered lipsync service using Wav2Lip or MuseTalk models for real-time avatar animation. Streams lip-synced video over WebRTC, supports custom avatar uploads, text-driven chat with TTS integration, and direct audio-based lip-sync. Optimized for Intel XPU acceleration.',
  icon: Video,
  port: 8022,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'Wav2Lip',
    device: 'CPU',
  },
  config: serviceConfig,
  logSources: [{ type: 'service', label: 'lipsync', target: 'lipsync' }],
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
      doc.models?.default?.device ?? 'CPU',
      '--source',
      doc.models?.default?.source || 'huggingface',
      '--avatar_model',
      (doc.models?.default?.name ?? 'Wav2Lip').toLowerCase() === 'musetalk'
        ? 'musetalk'
        : 'wav2lip',
    ]

    const serverIceServerUrl = (
      doc.metadata as { serverIceServerUrl?: string } | undefined
    )?.serverIceServerUrl
    if (serverIceServerUrl) {
      args.push('--ice_server', serverIceServerUrl)
    }

    // 'auto' lets the worker enable frame generation only when measured
    // inference FPS cannot reach the avatar frame rate.
    const frameGeneration =
      (doc.metadata as { frameGeneration?: boolean } | undefined)
        ?.frameGeneration ?? true
    args.push('--frame_gen', frameGeneration ? 'auto' : 'off')

    return args
  },
  workerSubDir: 'lipsync',
  modelDirectories: ['models/wav2lip', 'models/musetalk'],
}
