// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import type { DemoParam } from '@/types/demo-params'
import { getLanguagesForModel, getVoicesForModel } from '../config'

const TTS_DEFAULTS = {
  speed: 1.0,
  format: 'wav',
  volume: 1.0,
}

const TTS_FORMAT_OPTIONS = [
  { value: 'wav', label: 'WAV' },
  { value: 'mp3', label: 'MP3' },
  { value: 'ogg', label: 'OGG' },
]

export interface TtsParamValues {
  language: string
  voice: string
  speed: number
  format: string
  volume: number
}

export function useTtsParams(
  model: string,
  voiceDownloadMap?: Record<string, boolean> | null,
): {
  values: TtsParamValues
  params: DemoParam[]
} {
  const languages = useMemo(() => getLanguagesForModel(model), [model])
  const allVoices = useMemo(() => getVoicesForModel(model), [model])

  const [language, setLanguage] = useState(() => languages[0]?.value ?? '')
  const [voice, setVoice] = useState(() => allVoices[0]?.id ?? '')
  const [speed, setSpeed] = useState(TTS_DEFAULTS.speed)
  const [format, setFormat] = useState(TTS_DEFAULTS.format)
  const [volume, setVolume] = useState(TTS_DEFAULTS.volume)

  // Reset language & voice when model changes
  const [prevModel, setPrevModel] = useState(model)
  if (prevModel !== model) {
    setPrevModel(model)
    setLanguage(languages[0]?.value ?? '')
    setVoice(allVoices[0]?.id ?? '')
  }

  // Filtered voices based on selected language
  const voiceOptions = useMemo(() => {
    const filtered = language
      ? allVoices.filter((v) => v.language === language)
      : allVoices
    return filtered.map((v) => ({
      value: v.id,
      label: v.label,
      ...(voiceDownloadMap
        ? { downloaded: voiceDownloadMap[v.id] === true }
        : {}),
    }))
  }, [allVoices, language, voiceDownloadMap])

  // Derive effective voice — auto-select first if current is invalid
  const effectiveVoice = useMemo(() => {
    if (voiceOptions.some((v) => v.value === voice)) return voice
    return voiceOptions[0]?.value ?? ''
  }, [voiceOptions, voice])

  const isKokoro = model === 'kokoro'

  const values: TtsParamValues = {
    language,
    voice: effectiveVoice,
    speed,
    format,
    volume: isKokoro ? volume : TTS_DEFAULTS.volume,
  }

  const selectedVoiceNotCached =
    voiceDownloadMap && effectiveVoice
      ? voiceDownloadMap[effectiveVoice] === false
      : false

  const params: DemoParam[] = [
    ...(languages.length > 1
      ? [
          {
            type: 'select' as const,
            id: 'language',
            label: 'Language',
            value: language,
            options: languages,
            onChange: setLanguage,
          },
        ]
      : []),
    {
      type: 'select',
      id: 'voice',
      label: 'Voice',
      value: effectiveVoice,
      options: voiceOptions,
      onChange: setVoice,
      hint: selectedVoiceNotCached
        ? 'Voice not cached — first synthesis may be slow while the model downloads.'
        : undefined,
    },
    {
      type: 'slider',
      id: 'speed',
      label: 'Speed',
      value: speed,
      min: 0.25,
      max: 4.0,
      step: 0.25,
      onChange: setSpeed,
    },
    ...(isKokoro
      ? [
          {
            type: 'slider' as const,
            id: 'volume',
            label: 'Volume',
            value: volume,
            min: 0.0,
            max: 5.0,
            step: 0.1,
            onChange: setVolume,
          },
        ]
      : []),
    {
      type: 'select',
      id: 'format',
      label: 'Output Format',
      value: format,
      options: TTS_FORMAT_OPTIONS,
      onChange: setFormat,
    },
  ]

  return { values, params }
}
