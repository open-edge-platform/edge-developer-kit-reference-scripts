// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { useDemoParams } from '@/services/common/demo/use-demo-params'
import {
  getLanguagesForModel,
  getTtsCapabilities,
  getVoicesForModel,
  ttsFormatLabel,
} from '../lib/tts-models'

const TTS_DEFAULTS = {
  speed: 1.0,
  format: 'wav',
  volume: 1.0,
}

export interface TtsParamValues {
  language: string
  voice: string
  speed: number
  format: string
  volume: number
}

interface UseTtsDemoParamsOptions {
  /** Keeps the settings per instance across demo remounts under a `DemoSessionProvider`. */
  sessionKey?: string
}

/** Records which model the language and voice were chosen for. */
interface ParamState extends TtsParamValues {
  model: string
}

function modelStart(model: string): Pick<ParamState, 'language' | 'voice'> {
  return {
    language: getLanguagesForModel(model)[0]?.value ?? '',
    voice: getVoicesForModel(model)[0]?.id ?? '',
  }
}

/** The TTS settings `model` supports and their controls; `voiceDownloadMap` marks uncached voices. */
export function useTtsDemoParams(
  model: string,
  voiceDownloadMap?: Record<string, boolean> | null,
  options?: UseTtsDemoParamsOptions,
): {
  values: TtsParamValues
  params: DemoParam[]
} {
  const languages = getLanguagesForModel(model)
  const allVoices = getVoicesForModel(model)
  const capabilities = getTtsCapabilities(model)

  const { values: state, set } = useDemoParams<ParamState>(
    {
      model,
      ...modelStart(model),
      speed: TTS_DEFAULTS.speed,
      format: TTS_DEFAULTS.format,
      volume: TTS_DEFAULTS.volume,
    },
    { sessionKey: options?.sessionKey },
  )
  const { language, voice, speed, format, volume } = state

  // A different model (also after a restart with kept settings) starts from its first voice.
  if (state.model !== model) {
    const start = modelStart(model)
    set('model', model)
    set('language', start.language)
    set('voice', start.voice)
  }

  const voiceOptions = (
    language ? allVoices.filter((v) => v.language === language) : allVoices
  ).map((v) => ({
    value: v.id,
    label: v.label,
    ...(voiceDownloadMap
      ? { downloaded: voiceDownloadMap[v.id] === true }
      : {}),
  }))

  // A voice the language does not have falls back to its first.
  const effectiveVoice = voiceOptions.some((v) => v.value === voice)
    ? voice
    : (voiceOptions[0]?.value ?? '')

  // A format the model lacks (e.g. kept from an older session) falls back to its first.
  const formatOptions = capabilities.formats.map((value) => ({
    value,
    label: ttsFormatLabel(value),
  }))
  const effectiveFormat = capabilities.formats.includes(format)
    ? format
    : capabilities.formats[0]

  const values: TtsParamValues = {
    language,
    voice: effectiveVoice,
    speed: capabilities.speed ? speed : TTS_DEFAULTS.speed,
    format: effectiveFormat,
    volume: capabilities.volume ? volume : TTS_DEFAULTS.volume,
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
            onChange: (v: string) => set('language', v),
          },
        ]
      : []),
    ...(voiceOptions.length > 0
      ? [
          {
            type: 'select' as const,
            id: 'voice',
            label: 'Voice',
            value: effectiveVoice,
            options: voiceOptions,
            onChange: (v: string) => set('voice', v),
            hint: selectedVoiceNotCached
              ? 'Voice not cached — first synthesis may be slow while the model downloads.'
              : undefined,
          },
        ]
      : []),
    ...(capabilities.speed
      ? [
          {
            type: 'slider' as const,
            id: 'speed',
            label: 'Speed',
            value: speed,
            min: 0.25,
            max: 4.0,
            step: 0.25,
            onChange: (v: number) => set('speed', v),
          },
        ]
      : []),
    ...(capabilities.volume
      ? [
          {
            type: 'slider' as const,
            id: 'volume',
            label: 'Volume',
            value: volume,
            min: 0.0,
            max: 5.0,
            step: 0.1,
            onChange: (v: number) => set('volume', v),
          },
        ]
      : []),
    ...(formatOptions.length > 1
      ? [
          {
            type: 'select' as const,
            id: 'format',
            label: 'Output Format',
            value: effectiveFormat,
            options: formatOptions,
            onChange: (v: string) => set('format', v),
          },
        ]
      : []),
  ]

  return { values, params }
}
