// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

const STT_DEFAULTS = {
  language: 'en',
  useDenoise: 'false',
}

export const STT_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'ja', label: 'Japanese' },
  { value: 'es', label: 'Spanish' },
]

const STT_DENOISE_OPTIONS = [
  { value: 'false', label: 'Disabled' },
  { value: 'true', label: 'Enabled' },
]

export interface SttParamValues {
  language: string
  useDenoise: string
}

export function useSttParams(initial?: Partial<SttParamValues>): {
  values: SttParamValues
  params: DemoParam[]
} {
  const [language, setLanguage] = useState(
    initial?.language ?? STT_DEFAULTS.language,
  )
  const [useDenoise, setUseDenoise] = useState(
    initial?.useDenoise ?? STT_DEFAULTS.useDenoise,
  )

  const values: SttParamValues = { language, useDenoise }

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'language',
      label: 'Language',
      value: language,
      options: STT_LANGUAGE_OPTIONS,
      onChange: setLanguage,
    },
    {
      type: 'select',
      id: 'denoise',
      label: 'Noise Suppression',
      value: useDenoise,
      options: STT_DENOISE_OPTIONS,
      onChange: setUseDenoise,
    },
  ]

  return { values, params }
}
