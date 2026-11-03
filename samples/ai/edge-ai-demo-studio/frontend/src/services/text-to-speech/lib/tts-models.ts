// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FASTSPEECH2_VOICES } from './voices/fastspeech2'
import { KOKORO_VOICES } from './voices/kokoro'
import { MALAYA_VOICES } from './voices/malaya'
import { SPEECHT5_VOICES } from './voices/oep'
import { PIPER_VOICES } from './voices/piper'
import { POCKET_VOICES } from './voices/pocket'
import { VIENEU_VOICES } from './voices/vieneu'
import type { VoiceInfo } from './voices/types'

// Per-model worker, request capabilities and voices. Models other than the built-in workers'
// are served by the OEP wrapper, workers/services/text-to-speech/oep-tts.

/** Directory under workers/services/text-to-speech that serves a model. */
const OEP_TTS_WORKER = 'oep-tts'
export type TtsWorker =
  | 'kokoro'
  | 'malaya'
  | 'piper'
  | 'pocket-tts'
  | 'vieneu'
  | 'fastspeech2-hs'
  | typeof OEP_TTS_WORKER

const LOCAL_TTS_WORKERS = new Set<TtsWorker>([
  'kokoro',
  'malaya',
  'piper',
  'pocket-tts',
  'vieneu',
  'fastspeech2-hs',
])

/** Built-in workers are named by their model id; anything else goes to the OEP wrapper. */
export function getTtsWorker(model: string): TtsWorker {
  return LOCAL_TTS_WORKERS.has(model as TtsWorker)
    ? (model as TtsWorker)
    : OEP_TTS_WORKER
}

export function isOepTtsModel(model: string): boolean {
  return getTtsWorker(model) === OEP_TTS_WORKER
}

function isSpeechT5Model(model: string): boolean {
  return /speech[-_]?t5/i.test(model)
}

/** What the request body for a model may carry; the demo hides the rest. */
export interface TtsCapabilities {
  /** `response_format` values the worker accepts, first one is the default. */
  formats: string[]
  speed: boolean
  volume: boolean
}

// OpenAI response_format names, which every worker validates (Opus in Ogg is `opus`, not `ogg`).
const TTS_FORMATS = ['wav', 'mp3', 'opus']

export function getTtsCapabilities(model: string): TtsCapabilities {
  if (isOepTtsModel(model)) {
    // Upstream synthesizes WAV only; the wrapper re-encodes and applies speed, but not volume.
    return { formats: TTS_FORMATS, speed: true, volume: false }
  }
  return { formats: TTS_FORMATS, speed: true, volume: model === 'kokoro' }
}

const TTS_FORMAT_LABELS: Record<string, string> = {
  wav: 'WAV',
  mp3: 'MP3',
  opus: 'Opus',
}

export function ttsFormatLabel(format: string): string {
  return TTS_FORMAT_LABELS[format] ?? format.toUpperCase()
}

export interface SpeechRequestParams {
  input: string
  voice: string
  speed: number
  responseFormat: string
  volumeMultiplier?: number
  /** Stream sentence by sentence (a WAV with placeholder sizes, see wav-stream.ts). */
  stream?: boolean
}

/** Body for `POST /v1/audio/speech`, shaped for whichever worker serves `model`. */
export function buildSpeechRequestBody(
  model: string,
  params: SpeechRequestParams,
): Record<string, unknown> {
  if (isOepTtsModel(model)) {
    const capabilities = getTtsCapabilities(model)
    const responseFormat = capabilities.formats.includes(params.responseFormat)
      ? params.responseFormat
      : capabilities.formats[0]
    return {
      model,
      input: params.input,
      // No voice: upstream uses its default speaker.
      ...(params.voice && { voice: params.voice }),
      speed: params.speed,
      response_format: responseFormat,
      ...(params.stream && { stream: true }),
    }
  }
  return {
    input: params.input,
    voice: params.voice,
    speed: params.speed,
    response_format: params.responseFormat,
    stream: params.stream ?? false,
    ...(params.volumeMultiplier !== undefined && {
      volume_multiplier: params.volumeMultiplier,
    }),
  }
}

/** The voices `model` offers. */
export function getVoicesForModel(model: string): VoiceInfo[] {
  if (model === 'malaya') return MALAYA_VOICES
  if (model === 'piper') return PIPER_VOICES
  if (model === 'kokoro') return KOKORO_VOICES
  if (model === 'pocket-tts') return POCKET_VOICES
  if (model === 'vieneu') return VIENEU_VOICES
  if (model === 'fastspeech2-hs') return FASTSPEECH2_VOICES
  if (isSpeechT5Model(model)) return SPEECHT5_VOICES
  // Other OEP models (e.g. from deployment.json) use the worker's default speaker.
  return []
}

/** In voice-list order. */
export function getLanguagesForModel(
  model: string,
): { value: string; label: string }[] {
  const voices = getVoicesForModel(model)
  const seen = new Set<string>()
  const result: { value: string; label: string }[] = []
  for (const v of voices) {
    if (!seen.has(v.language)) {
      seen.add(v.language)
      result.push({ value: v.language, label: v.language })
    }
  }
  return result
}
