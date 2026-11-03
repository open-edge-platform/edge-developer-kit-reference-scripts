// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Mic } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import {
  getSttBackend,
  isSttModelSupported,
  serviceConfig,
  STT_BACKEND_OPTIONS,
} from './config'

export const service: ServiceMeta = {
  id: 'speech-to-text',
  name: 'Speech to Text',
  multiInstance: true,
  /** The worker runs its own OVMS on base port + 1. */
  portBlock: 2,
  description:
    'Real-time speech recognition with low-latency transcription using Whisper models optimized for Intel hardware.',
  longDescription:
    'Automatic speech recognition with Whisper models on one of two backends selectable in the Runtime Settings: the Open Edge Platform audio-analyzer microservice run natively (Whisper on OpenVINO GenAI, OpenAI-compatible batch transcription with json, text, verbose_json, srt and vtt output, SSE and NDJSON streaming, and an OpenAI Realtime-style WebSocket for live microphone input), or the built-in OpenVINO Model Server worker (batch transcription and translation to English with optional noise suppression). Supports 99+ languages; models are exported to OpenVINO on first start.',
  icon: Mic,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: 'openai/whisper-base',
    device: 'AUTO',
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
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name ?? 'openai/whisper-base'
    const device = doc.models?.default?.device ?? 'AUTO'
    const precision = getEffectivePrecision(
      serviceConfig,
      doc.models?.default?.quant,
    )
    const args = [
      '--model',
      model,
      '--device',
      device,
      '--port',
      String(doc.port),
      ...(precision ? ['--precision', precision] : []),
    ]
    if (getSttBackend(doc.metadata) === 'ovms') {
      // Flags only the OVMS worker understands.
      args.push('--source', doc.models?.default?.source || 'huggingface')
      args.push(
        '--denoise-model-id',
        doc.models?.denoise?.name ?? 'noise-suppression-poconetlike-0001',
        '--denoise-device',
        doc.metadata?.denoiseDevice || (doc.models?.denoise?.device ?? device),
      )
    }
    return args
  },
  workerSubDir: (doc: PayloadService) =>
    `services/speech-to-text/${getSttBackend(doc.metadata)}`,
  // models/stt: both backends' converted models; models/huggingface: the shared HF cache.
  modelDirectories: ['models/stt', 'models/huggingface'],
  // The worker follows the backend, not the model, so a preset is checked on every backend
  // that can run it.
  catalogRows: (doc, id) =>
    STT_BACKEND_OPTIONS.map((o) => o.value)
      .filter((backend) => isSttModelSupported(backend, id))
      .map((backend) => ({
        ...doc,
        metadata: { ...doc.metadata, sttBackend: backend },
      })),
}
