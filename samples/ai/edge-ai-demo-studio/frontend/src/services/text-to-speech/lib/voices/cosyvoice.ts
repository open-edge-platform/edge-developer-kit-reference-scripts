// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DialectInfo, VoiceInfo } from './types'

/** What CosyVoice 3 reads; the text itself decides, so every voice is offered in each. */
const COSYVOICE_LANGUAGES = [
  'Chinese',
  'English',
  'Japanese',
  'Korean',
  'German',
  'Spanish',
  'French',
  'Italian',
  'Russian',
]

/**
 * The built-in voice: upstream's own sample speaker, a woman speaking Mandarin. Voices added in the
 * demo, over the API or to models/tts/cosyvoice3/voices come from the worker's GET
 * /v1/audio/voices (getVoicesWithAdded).
 */
export const COSYVOICE_VOICES: VoiceInfo[] = COSYVOICE_LANGUAGES.map(
  (language) => ({ id: 'zh_female', label: 'Built-in Female', language }),
)

/** The language CosyVoice 3's dialects are of. */
export const COSYVOICE_DIALECT_LANGUAGE = 'Chinese'

/** Shown under a language whose text needs writing a certain way (measured with Whisper). */
export const COSYVOICE_LANGUAGE_HINTS: Record<string, string> = {
  Japanese: 'Write Japanese in kana: kanji are read with Chinese readings.',
}

/** The Chinese dialects CosyVoice 3 reads Chinese text in on request: the worker's `DIALECTS`. */
export const COSYVOICE_DIALECTS: DialectInfo[] = [
  { id: 'cantonese', label: 'Cantonese (广东话)' },
  { id: 'minnan', label: 'Hokkien / Minnan (闽南话)' },
  { id: 'sichuan', label: 'Sichuanese (四川话)' },
  { id: 'shanghai', label: 'Shanghainese (上海话)' },
  { id: 'dongbei', label: 'Northeastern (东北话)' },
  { id: 'tianjin', label: 'Tianjin (天津话)' },
  { id: 'shandong', label: 'Shandong (山东话)' },
  { id: 'henan', label: 'Henan (河南话)' },
  { id: 'hubei', label: 'Hubei (湖北话)' },
  { id: 'hunan', label: 'Hunan (湖南话)' },
  { id: 'jiangxi', label: 'Jiangxi (江西话)' },
  { id: 'guizhou', label: 'Guizhou (贵州话)' },
  { id: 'yunnan', label: 'Yunnan (云南话)' },
  { id: 'gansu', label: 'Gansu (甘肃话)' },
  { id: 'ningxia', label: 'Ningxia (宁夏话)' },
  { id: 'shanxi', label: 'Shanxi (山西话)' },
  { id: 'shaanxi', label: 'Shaanxi (陕西话)' },
]
