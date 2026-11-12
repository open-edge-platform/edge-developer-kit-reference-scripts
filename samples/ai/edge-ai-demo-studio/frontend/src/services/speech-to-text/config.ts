// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModelOption, Service, ServiceConfig } from '@/services/types'
import { getEffectiveModel } from '@/types/service'

/**
 * Speech to Text runs on one of two workers under workers/services/speech-to-text/: `oep` (OEP
 * audio-analyzer, Whisper on OpenVINO GenAI) or `ovms` (Whisper and Qwen3-ASR on OVMS). The choice
 * is `metadata.sttBackend` and applies on (re)start; both answer `POST /v1/audio/transcriptions`.
 */

export type SttBackendId = 'oep' | 'ovms'

/**
 * Auto-detect language, OVMS only: the worker lets the model detect it (`verbose_json` language is
 * `null`). Upstream OEP takes a missing language as English, so it is not offered there.
 */
export const STT_AUTO_LANGUAGE = 'auto'

const DEFAULT_STT_BACKEND: SttBackendId = 'oep'

export interface SttBackendOption {
  value: SttBackendId
  label: string
  description: string
}

export const STT_BACKEND_OPTIONS: SttBackendOption[] = [
  {
    value: 'oep',
    label: 'OpenVINO GenAI · OEP',
    description:
      'Open Edge Platform audio-analyzer run natively: Whisper on OpenVINO GenAI with streaming responses and live microphone transcription over /v1/realtime.',
  },
  {
    value: 'ovms',
    label: 'OpenVINO Model Server',
    description:
      'Built-in worker: Whisper and Qwen3-ASR served by OpenVINO Model Server. Batch transcription and translation to English with optional noise suppression, and live microphone transcription over /v1/audio/stream.',
  },
]

function isSttBackend(value: unknown): value is SttBackendId {
  return value === 'oep' || value === 'ovms'
}

export function getSttBackend(
  metadata: Service['metadata'] | Record<string, unknown> | undefined | null,
): SttBackendId {
  const value = (metadata as { sttBackend?: unknown } | undefined)?.sttBackend
  return isSttBackend(value) ? value : DEFAULT_STT_BACKEND
}

const STT_DEVICES = ['AUTO', 'CPU', 'GPU', 'NPU']
// Whisper Large v3 compiles for the NPU 3720 but fails at inference (driver execution limit);
// Large v3 Turbo runs there.
const NO_NPU_DEVICES = ['AUTO', 'CPU', 'GPU']

interface WhisperModel {
  value: string
  label: string
  /** Fails at inference on the NPU. */
  noNpu?: boolean
}

// The OEP worker strips the openai/ prefix (upstream keys by bare name); OVMS pulls the exact id.
const WHISPER_MODELS: WhisperModel[] = [
  {
    value: 'openai/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
  },
  {
    value: 'openai/whisper-large-v3',
    label: 'Whisper Large v3',
    noNpu: true,
  },
  { value: 'openai/whisper-medium', label: 'Whisper Medium' },
  { value: 'openai/whisper-small', label: 'Whisper Small' },
  { value: 'openai/whisper-tiny', label: 'Whisper Tiny' },
  { value: 'openai/whisper-base', label: 'Whisper Base' },
]

const WHISPER_MODEL_OPTIONS: ModelOption[] = WHISPER_MODELS.map(
  ({ value, label, noNpu }) => ({
    value,
    label,
    availableDevices: noNpu ? NO_NPU_DEVICES : STT_DEVICES,
    backend: 'openvino',
  }),
)

/**
 * OVMS only (OEP runs only Whisper). Converted on first start in its own pinned optimum env,
 * workers/common/ovms-export-qwen3-asr.
 */
const QWEN3_ASR_MODEL = 'Qwen/Qwen3-ASR-1.7B-hf'

const OVMS_ONLY_MODELS: ModelOption[] = [
  {
    value: QWEN3_ASR_MODEL,
    label: 'Qwen3 ASR 1.7B',
    availableDevices: ['AUTO', 'CPU', 'GPU'],
    backend: 'openvino',
  },
]

/** Rules out only the OVMS-only presets on OEP; custom ids are left to the worker. */
export function isSttModelSupported(
  backend: SttBackendId,
  model: string | undefined | null,
): boolean {
  if (!model || backend === 'ovms') return true
  return !OVMS_ONLY_MODELS.some((m) => m.value === model)
}

/** First-start `--weight-format`; int8 is a quarter of fp32's size, near-identical transcripts. */
const STT_PRECISIONS: Pick<
  ServiceConfig,
  'availableWeightFormats' | 'defaultWeightFormat'
> = {
  availableWeightFormats: ['fp32', 'fp16', 'int8', 'int4'],
  defaultWeightFormat: 'int8',
}

export function getSttServiceConfig(backend: SttBackendId): ServiceConfig {
  if (backend === 'ovms') {
    return {
      availableModels: [...OVMS_ONLY_MODELS, ...WHISPER_MODEL_OPTIONS],
      availableModelSources: [
        { value: 'huggingface', label: 'Hugging Face' },
        { value: 'modelscope', label: 'ModelScope' },
      ],
      supportsCustomModel: true,
      ...STT_PRECISIONS,
    }
  }
  return {
    availableModels: WHISPER_MODEL_OPTIONS,
    availableModelSources: [{ value: 'huggingface', label: 'Hugging Face' }],
    supportsCustomModel: true,
    ...STT_PRECISIONS,
  }
}

/** Static config (deployment.json docs, seeding): the union of both backends. */
export const serviceConfig: ServiceConfig = {
  availableModels: [...OVMS_ONLY_MODELS, ...WHISPER_MODEL_OPTIONS],
  availableModelSources: [{ value: 'huggingface', label: 'Hugging Face' }],
  supportsCustomModel: true,
  ...STT_PRECISIONS,
}

/** What a backend adds to batch transcription (both also offer live transcription). */
export interface SttCapabilities {
  backend: SttBackendId
  /** `stream=true` SSE and the NDJSON `/v1/audio/transcriptions/stream`. */
  streaming: boolean
  /** `use_denoise=true` on `/v1/audio/transcriptions`. */
  denoise: boolean
  /** `POST /v1/audio/translations`. */
  translation: boolean
  /** `language=auto` (`STT_AUTO_LANGUAGE`): the model detects the language. */
  autoLanguage: boolean
}

/** The backend the process was started with (`applied`), else the saved one its next start uses. */
export function getRunningSttBackend(
  service: Pick<Service, 'metadata' | 'applied'> | undefined,
): SttBackendId {
  return getSttBackend(service?.applied?.metadata ?? service?.metadata)
}

export function getSttCapabilities(
  service: Pick<Service, 'metadata' | 'applied'> | undefined,
): SttCapabilities {
  const backend = getRunningSttBackend(service)
  if (backend === 'ovms') {
    return {
      backend,
      streaming: false,
      denoise: true,
      translation: true,
      autoLanguage: true,
    }
  }
  return {
    backend,
    streaming: true,
    denoise: false,
    translation: false,
    autoLanguage: false,
  }
}

/** Silences, in seconds, Live mode offers to end an utterance with. */
export const STT_PAUSE_SECONDS = [0.5, 1, 1.5, 2, 3]

/** How readily Live mode's voice detection takes sound for speech. */
export type SttVadSensitivity = 'low' | 'normal' | 'high'

export const STT_VAD_SENSITIVITY_OPTIONS: {
  value: SttVadSensitivity
  label: string
}[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

export function isSttVadSensitivity(value: string): value is SttVadSensitivity {
  return value === 'low' || value === 'normal' || value === 'high'
}

/**
 * VAD threshold per sensitivity; `normal` is the worker default. OEP compares a 30 ms frame's RMS
 * (0–1), OVMS's Silero a speech probability (0–1). Lower hears quieter speech, and more noise.
 */
const STT_VAD_THRESHOLDS: Record<
  SttBackendId,
  Record<SttVadSensitivity, number>
> = {
  oep: { low: 0.04, normal: 0.02, high: 0.01 },
  ovms: { low: 0.65, normal: 0.5, high: 0.35 },
}

export function getSttVadThreshold(
  backend: SttBackendId,
  sensitivity: SttVadSensitivity,
): number {
  return STT_VAD_THRESHOLDS[backend][sensitivity]
}

const LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans',
  am: 'Amharic',
  ar: 'Arabic',
  as: 'Assamese',
  az: 'Azerbaijani',
  ba: 'Bashkir',
  be: 'Belarusian',
  bg: 'Bulgarian',
  bn: 'Bengali',
  bo: 'Tibetan',
  br: 'Breton',
  bs: 'Bosnian',
  ca: 'Catalan',
  cs: 'Czech',
  cy: 'Welsh',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  eu: 'Basque',
  fa: 'Persian',
  fi: 'Finnish',
  fil: 'Filipino',
  fo: 'Faroese',
  fr: 'French',
  gl: 'Galician',
  gu: 'Gujarati',
  ha: 'Hausa',
  haw: 'Hawaiian',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  ht: 'Haitian Creole',
  hu: 'Hungarian',
  hy: 'Armenian',
  id: 'Indonesian',
  is: 'Icelandic',
  it: 'Italian',
  ja: 'Japanese',
  jw: 'Javanese',
  ka: 'Georgian',
  kk: 'Kazakh',
  km: 'Khmer',
  kn: 'Kannada',
  ko: 'Korean',
  la: 'Latin',
  lb: 'Luxembourgish',
  ln: 'Lingala',
  lo: 'Lao',
  lt: 'Lithuanian',
  lv: 'Latvian',
  mg: 'Malagasy',
  mi: 'Maori',
  mk: 'Macedonian',
  ml: 'Malayalam',
  mn: 'Mongolian',
  mr: 'Marathi',
  ms: 'Malay',
  mt: 'Maltese',
  my: 'Burmese',
  ne: 'Nepali',
  nl: 'Dutch',
  nn: 'Nynorsk',
  no: 'Norwegian',
  oc: 'Occitan',
  pa: 'Punjabi',
  pl: 'Polish',
  ps: 'Pashto',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sa: 'Sanskrit',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  sn: 'Shona',
  so: 'Somali',
  sq: 'Albanian',
  sr: 'Serbian',
  su: 'Sundanese',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  tg: 'Tajik',
  th: 'Thai',
  tk: 'Turkmen',
  tl: 'Tagalog',
  tr: 'Turkish',
  tt: 'Tatar',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  vi: 'Vietnamese',
  yi: 'Yiddish',
  yo: 'Yoruba',
  yue: 'Cantonese',
  zh: 'Chinese',
}

/** Whisper's 99 tokenizer languages; large-v3 adds Cantonese (`yue`). */
const WHISPER_LANGUAGES = Object.keys(LANGUAGE_NAMES).filter(
  (code) => code !== 'fil' && code !== 'yue',
)

/** Qwen3-ASR's 30 languages per its model card; its Chinese dialects come under Chinese. */
const QWEN3_ASR_LANGUAGES = [
  'zh',
  'en',
  'yue',
  'ar',
  'de',
  'fr',
  'es',
  'pt',
  'id',
  'it',
  'ko',
  'ru',
  'th',
  'vi',
  'ja',
  'tr',
  'hi',
  'ms',
  'nl',
  'sv',
  'da',
  'fi',
  'pl',
  'cs',
  'fil',
  'fa',
  'el',
  'hu',
  'mk',
  'ro',
]

export interface SttLanguageOption {
  value: string
  label: string
}

/**
 * Languages `model` transcribes, sorted by name, after Auto-detect when `autoLanguage`; a custom
 * model id counts as Whisper.
 */
export function getSttLanguageOptions(
  model: string | undefined,
  autoLanguage = false,
): SttLanguageOption[] {
  const id = (model ?? '').toLowerCase()
  const codes = id.includes('qwen3-asr')
    ? QWEN3_ASR_LANGUAGES
    : id.includes('large-v3')
      ? [...WHISPER_LANGUAGES, 'yue']
      : WHISPER_LANGUAGES
  const languages = codes
    .map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return autoLanguage
    ? [{ value: STT_AUTO_LANGUAGE, label: 'Auto-detect' }, ...languages]
    : languages
}

/** The language list of the STT service as it runs now, for samples that pick a language. */
export function getServiceSttLanguageOptions(
  service: Service | undefined,
): SttLanguageOption[] {
  return getSttLanguageOptions(
    service ? getEffectiveModel(service).name : undefined,
    getSttCapabilities(service).autoLanguage,
  )
}

/**
 * `language` if offered, else Auto-detect where offered, else English (every model knows it; both
 * workers default to it). With no `language`, the default.
 */
export function resolveSttLanguage(
  language: string | null | undefined,
  options: SttLanguageOption[],
): string {
  if (language && options.some((o) => o.value === language)) return language
  return options.some((o) => o.value === STT_AUTO_LANGUAGE)
    ? STT_AUTO_LANGUAGE
    : 'en'
}
