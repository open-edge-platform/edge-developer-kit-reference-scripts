// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Video } from 'lucide-react'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { serviceConfig } from './config'

export const service: ServiceMeta = {
  id: 'lipsync',
  name: 'Lipsync',
  multiInstance: true,
  description:
    'Real-time avatar lip-syncing with Wav2Lip or MuseTalk, streamed over WebRTC.',
  longDescription:
    'AI-powered lipsync service using Wav2Lip or MuseTalk models for real-time avatar animation. Streams lip-synced video over WebRTC, supports custom avatar uploads, text-driven chat with TTS integration, and direct audio-based lip-sync. Optimized for Intel XPU acceleration.',
  icon: Video,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'Wav2Lip',
    device: 'AUTO',
  },
  config: serviceConfig,
  logSources: [{ type: 'service', label: 'lipsync', target: 'lipsync' }],
  healthCheck: {
    url: '/healthcheck',
  },
}

export const worker: WorkerConfig = {
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const avatarModel =
      (doc.models?.default?.name ?? 'Wav2Lip').toLowerCase() === 'musetalk'
        ? 'musetalk'
        : 'wav2lip'
    const args = [
      '--port',
      String(doc.port),
      '--device',
      doc.models?.default?.device ?? 'AUTO',
      '--source',
      doc.models?.default?.source || 'huggingface',
      '--avatar_model',
      avatarModel,
    ]

    const precision = getEffectivePrecision(
      serviceConfig,
      doc.models?.default?.quant,
    )
    if (avatarModel === 'wav2lip' && precision && precision !== 'auto') {
      args.push(precision === 'int8' ? '--int8' : '--no-int8')
    }

    const { batchSize, serverIceServerUrl } = getServiceMetadata(doc)
    // Unset, the worker picks the batch size for the device.
    if (Number.isInteger(batchSize) && Number(batchSize) > 0) {
      args.push('--batch_size', String(batchSize))
    }
    if (serverIceServerUrl) {
      args.push('--ice_server', serverIceServerUrl)
    }

    // Frame generation is per request. No --frame_gen_url: the worker asks the app
    // (EDGE_AI_STUDIO_URL) where the Frame Generation Default instance answers.

    return args
  },
  workerSubDir: 'services/lipsync',
  modelDirectories: ['models/wav2lip', 'models/musetalk'],
}
