// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  COSYVOICE_DIALECT_LANGUAGE,
  COSYVOICE_DIALECTS,
  COSYVOICE_LANGUAGE_HINTS,
  COSYVOICE_VOICES,
} from './voices/cosyvoice'
import { FASTSPEECH2_VOICES } from './voices/fastspeech2'
import { KOKORO_VOICES } from './voices/kokoro'
import { MALAYA_VOICES } from './voices/malaya'
import { SPEECHT5_VOICES } from './voices/oep'
import { PIPER_VOICES } from './voices/piper'
import { POCKET_VOICES } from './voices/pocket'
import { VIENEU_VOICES } from './voices/vieneu'
import type { DialectInfo, VoiceInfo } from './voices/types'

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
  | 'cosyvoice3'
  | typeof OEP_TTS_WORKER

const LOCAL_TTS_WORKERS = new Set<TtsWorker>([
  'kokoro',
  'malaya',
  'piper',
  'pocket-tts',
  'vieneu',
  'fastspeech2-hs',
  'cosyvoice3',
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
  /** One of the model's `getDialectsForModel` ids; absent reads the text as written. */
  dialect?: string
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
    ...(params.dialect && { dialect: params.dialect }),
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
  if (model === 'cosyvoice3') return COSYVOICE_VOICES
  if (isSpeechT5Model(model)) return SPEECHT5_VOICES
  // Other OEP models (e.g. from deployment.json) use the worker's default speaker.
  return []
}

/** The dialects `model` reads `language` in on request (`dialect`): CosyVoice 3's Chinese only. */
export function getDialectsForModel(
  model: string,
  language: string,
): DialectInfo[] {
  return model === 'cosyvoice3' && language === COSYVOICE_DIALECT_LANGUAGE
    ? COSYVOICE_DIALECTS
    : []
}

/** A dialect's label, for a request already made (its id when unknown). */
export function getDialectLabel(model: string, dialect: string): string {
  const dialects = model === 'cosyvoice3' ? COSYVOICE_DIALECTS : []
  return dialects.find((d) => d.id === dialect)?.label ?? dialect
}

/** How to write text in `language` for `model`, where it matters. */
export function getLanguageHint(
  model: string,
  language: string,
): string | undefined {
  return model === 'cosyvoice3' ? COSYVOICE_LANGUAGE_HINTS[language] : undefined
}

/** Models whose worker clones voices from recordings added with `POST /v1/audio/voices`. */
export function supportsVoiceCloning(model: string): boolean {
  return model === 'cosyvoice3'
}

/** Voice ids an added recording may take (the worker's rule): no spaces, up to 40 characters. */
export const CLONED_VOICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

/** The voices added to a cloning model's worker, from its `GET /v1/audio/voices`, in list order. */
export function getAddedVoiceIds(
  model: string,
  voiceMap: Record<string, boolean> | null | undefined,
): string[] {
  if (!voiceMap || !supportsVoiceCloning(model)) return []
  const builtIn = new Set(getVoicesForModel(model).map((v) => v.id))
  return Object.keys(voiceMap).filter((id) => !builtIn.has(id))
}

/** `model`'s voices, then those added to its worker, named by their id, in each of its languages. */
export function getVoicesWithAdded(
  model: string,
  voiceMap: Record<string, boolean> | null | undefined,
): VoiceInfo[] {
  const voices = getVoicesForModel(model)
  const added = getAddedVoiceIds(model, voiceMap)
  const languages = [...new Set(voices.map((v) => v.language))]
  return [
    ...voices,
    ...languages.flatMap((language) =>
      added.map((id) => ({ id, label: id, language })),
    ),
  ]
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
