// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Mic } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import {
  DEFAULT_STT_MODEL,
  getSttBackend,
  getSttDefaultModel,
  getSttServiceConfig,
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
    'Real-time speech recognition with low-latency transcription using Whisper, Qwen3-ASR and MERaLiON models optimized for Intel hardware.',
  longDescription:
    'Automatic speech recognition on one of three backends selectable in the Runtime Settings: the Open Edge Platform audio-analyzer microservice run natively (Whisper on OpenVINO GenAI, OpenAI-compatible batch transcription with json, text, verbose_json, srt and vtt output, SSE and NDJSON streaming, and an OpenAI Realtime-style WebSocket for live microphone input), the built-in OpenVINO Model Server worker (Whisper and Qwen3-ASR; batch transcription and translation to English with optional noise suppression), or the built-in MERaLiON worker (MERaLiON-3-3B-ASR from A*STAR for Singapore and Southeast Asian speech, including Singlish, Malay, Tamil, Hokkien and code-switching; it detects the language itself and only transcribes). Whisper supports 99+ languages; models are exported to OpenVINO on first start (MERaLiON downloads about 6.6 GB and needs about 20 GB of RAM to export).',
  icon: Mic,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_STT_MODEL,
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
    const backend = getSttBackend(doc.metadata)
    const model = doc.models?.default?.name ?? getSttDefaultModel(backend)
    const device = doc.models?.default?.device ?? 'AUTO'
    // The backend's own formats: MERaLiON exports int8 or int4 only.
    const precision = getEffectivePrecision(
      getSttServiceConfig(backend),
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
    if (backend !== 'oep') {
      args.push('--source', doc.models?.default?.source || 'huggingface')
    }
    if (backend === 'ovms') {
      // Flags only the OVMS worker understands.
      args.push(
        '--denoise-model-id',
        doc.models?.denoise?.name ?? 'noise-suppression-poconetlike-0001',
        '--denoise-device',
        doc.metadata?.denoiseDevice || (doc.models?.denoise?.device ?? device),
      )
      if (doc.metadata?.alignerWarmStart === true) {
        args.push('--warm-start-aligner')
      }
    }
    return args
  },
  workerSubDir: (doc: PayloadService) =>
    `services/speech-to-text/${getSttBackend(doc.metadata)}`,
  // models/stt: every backend's models; models/huggingface: the shared HF cache.
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
