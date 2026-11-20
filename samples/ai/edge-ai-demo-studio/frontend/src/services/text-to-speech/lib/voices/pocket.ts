// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { VoiceInfo } from './types'

/**
 * Each language is a checkpoint of its own, picked by the voice; the worker loads Indonesian at
 * start and the others on first use. Indonesian's voices are cloned from Common Voice recordings
 * shipped in its model repository; the others are Kyutai's pre-made voices, which speak every
 * language: each offers the voice Kyutai made for it first (English, eight English speakers).
 */
const INDONESIAN_VOICES: VoiceInfo[] = [
  { id: 'female_1', label: 'Female 1', language: 'Indonesian' },
  { id: 'female_2', label: 'Female 2', language: 'Indonesian' },
  { id: 'male_1', label: 'Male 1', language: 'Indonesian' },
  { id: 'male_2', label: 'Male 2', language: 'Indonesian' },
]

/** Kyutai's languages: the worker's voice id prefix and the voices, as in pocket-tts/main.py. */
const NATIVE_VOICES = [
  'estelle',
  'juergen',
  'giovanni',
  'rafael',
  'lola',
  'daan',
  'alba',
]

function nativeFirst(own: string): string[] {
  return [own, ...NATIVE_VOICES.filter((v) => v !== own)]
}

const KYUTAI_LANGUAGES: [language: string, prefix: string, voices: string[]][] =
  [
    [
      'English',
      'en',
      [
        'alba',
        'marius',
        'javert',
        'jean',
        'fantine',
        'cosette',
        'eponine',
        'azelma',
      ],
    ],
    ['French', 'fr', nativeFirst('estelle')],
    ['German', 'de', nativeFirst('juergen')],
    ['Italian', 'it', nativeFirst('giovanni')],
    ['Portuguese', 'pt', nativeFirst('rafael')],
    ['Spanish', 'es', nativeFirst('lola')],
    ['Dutch', 'nl', nativeFirst('daan')],
  ]

const capitalize = (name: string) => name[0].toUpperCase() + name.slice(1)

export const POCKET_VOICES: VoiceInfo[] = [
  ...INDONESIAN_VOICES,
  ...KYUTAI_LANGUAGES.flatMap(([language, prefix, voices]) =>
    voices.map((name) => ({
      id: `${prefix}_${name}`,
      label: capitalize(name),
      language,
    })),
  ),
]
