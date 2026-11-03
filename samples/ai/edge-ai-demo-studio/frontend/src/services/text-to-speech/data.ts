// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Volume2 } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import { getEffectivePrecision } from '@/services/model-config'
import type { ServiceMeta, WorkerConfig } from '@/services/types'
import { DEFAULT_TTS_MODEL, ttsConfig } from './config'
import { getTtsWorker, isOepTtsModel } from './lib/tts-models'

export const service: ServiceMeta = {
  id: 'text-to-speech',
  name: 'Text to Speech',
  multiInstance: true,
  description:
    'Natural-sounding speech synthesis with multiple voice options powered by Kokoro, Piper, Malaya, Pocket TTS, VieNeu-TTS, FastSpeech2 HS and SpeechT5 from the Open Edge Platform.',
  longDescription:
    'Neural text-to-speech engine producing natural, expressive speech. Supports Kokoro (Multilingual, OpenVINO), Piper (Multilingual, OpenVINO), Malaya (Malay, OpenVINO), Pocket TTS (Indonesian, OpenVINO), VieNeu-TTS v3 Turbo (Vietnamese, ONNX Runtime) and FastSpeech2 HS (Tamil, OpenVINO) as built-in workers, plus SpeechT5 (English, OpenVINO) from the Open Edge Platform text-to-speech microservice, run natively. Offers multiple voices, adjustable speed, streaming audio output and multiple audio formats where the selected model supports them.',
  icon: Volume2,
  supportedOS: ['linux', 'windows'],
  // Text and the last audio stay usable while stopped; there is no live device to release.
  keepDemoWhenStopped: true,
  execution: { mode: 'worker' },
  defaultModel: {
    name: DEFAULT_TTS_MODEL,
    device: 'AUTO',
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
  modelCatalog: 'script',
  buildArgs: (doc: PayloadService) => {
    const model = doc.models?.default?.name || DEFAULT_TTS_MODEL
    const args = [
      '--port',
      String(doc.port),
      '--device',
      doc.models?.default?.device || 'AUTO',
    ]
    if (isOepTtsModel(model)) {
      // The OEP wrapper serves several models from one directory; built-in workers reject `--model`.
      args.push('--model', model)
      const dtype = getEffectivePrecision(ttsConfig, doc.models?.default?.quant)
      if (dtype) {
        args.push('--dtype', dtype)
      }
      return args
    }
    const source = doc.models?.default?.source
    if (source) {
      args.push('--source', source)
    }
    return args
  },
  workerSubDir: (doc: PayloadService) =>
    `services/text-to-speech/${getTtsWorker(doc.models?.default?.name || DEFAULT_TTS_MODEL)}`,
  // models/huggingface: the shared HF cache the OEP backend exports from.
  modelDirectories: ['models/tts', 'models/huggingface'],
}
