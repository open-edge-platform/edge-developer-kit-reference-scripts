// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { useDemoParams } from '@/services/common/demo/use-demo-params'
import {
  getSttLanguageOptions,
  isSttVadSensitivity,
  STT_AUTO_LANGUAGE,
  STT_PAUSE_SECONDS,
  STT_VAD_SENSITIVITY_OPTIONS,
  type SttVadSensitivity,
} from '../config'

const STT_DEFAULTS = {
  // Falls back to DEFAULT_LANGUAGE where the backend lacks `autoLanguage`.
  language: STT_AUTO_LANGUAGE as string,
  useDenoise: false,
  // Both workers' own defaults.
  pauseSeconds: 0.5,
  vadSensitivity: 'normal' as SttVadSensitivity,
}

export type SttParamValues = typeof STT_DEFAULTS

// Every model knows it; both workers default to it.
const DEFAULT_LANGUAGE = 'en'

const PAUSE_OPTIONS = STT_PAUSE_SECONDS.map((seconds) => ({
  value: String(seconds),
  label: `${seconds} s`,
}))

interface SttParamOptions {
  /** Picks the Language list. */
  model?: string
  /** Offer Auto-detect (OVMS backend only); without it the language defaults to English. */
  autoLanguage?: boolean
  /** Offer Noise Suppression (OVMS backend only); without it `useDenoise` is always false. */
  denoise?: boolean
  /** Live mode: voice detection settings instead of Noise Suppression, which is batch only. */
  live?: boolean
  /** A live session runs and keeps its settings, so the controls are locked until it stops. */
  locked?: boolean
  /** Keeps the settings per instance across demo remounts under a `DemoSessionProvider`. */
  sessionKey?: string
}

/** STT demo settings: language, noise suppression (batch) and voice detection (live). */
export function useSttParams({
  model,
  autoLanguage = false,
  denoise = false,
  live = false,
  locked = false,
  sessionKey,
}: SttParamOptions) {
  const {
    values: { language, useDenoise, pauseSeconds, vadSensitivity },
    setters: { setLanguage, setUseDenoise, setPauseSeconds, setVadSensitivity },
  } = useDemoParams(STT_DEFAULTS, { sessionKey })

  const languageOptions = [
    ...(autoLanguage
      ? [{ value: STT_AUTO_LANGUAGE, label: 'Auto-detect' }]
      : []),
    ...getSttLanguageOptions(model),
  ]
  // Replaces a language kept from another model or backend that this one lacks (e.g. Auto on OEP).
  const knownLanguage = languageOptions.some((o) => o.value === language)
    ? language
    : autoLanguage
      ? STT_AUTO_LANGUAGE
      : DEFAULT_LANGUAGE

  const values: SttParamValues = {
    language: knownLanguage,
    useDenoise: denoise && useDenoise,
    pauseSeconds,
    vadSensitivity,
  }

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'language',
      label: 'Language',
      tooltip:
        'The language spoken in the audio, from those the model knows: Whisper 99 (100 on Large v3, with Cantonese), Qwen3-ASR 30 (its Chinese dialects under Chinese). Auto-detect (OpenVINO Model Server backend) lets the model identify it; choosing one is more reliable on short or accented clips.',
      value: knownLanguage,
      options: languageOptions,
      onChange: setLanguage,
      disabled: locked,
    },
  ]

  if (live) {
    params.push(
      {
        type: 'select',
        id: 'pause',
        label: 'Pause length',
        tooltip:
          'How long a silence ends an utterance, which is then transcribed. Longer keeps sentences together; shorter shows text sooner.',
        value: String(pauseSeconds),
        options: PAUSE_OPTIONS,
        onChange: (value) => setPauseSeconds(Number(value)),
        disabled: locked,
      },
      {
        type: 'select',
        id: 'vad-sensitivity',
        label: 'Speech sensitivity',
        tooltip:
          "How readily the worker's voice detection takes sound for speech: High hears quieter voices but more noise, Low ignores more background sound. It sets the energy threshold on the OEP backend and the Silero speech probability on OpenVINO Model Server.",
        value: vadSensitivity,
        options: STT_VAD_SENSITIVITY_OPTIONS,
        onChange: (value) => {
          if (isSttVadSensitivity(value)) setVadSensitivity(value)
        },
        disabled: locked,
      },
    )
  } else if (denoise) {
    params.push({
      type: 'toggle',
      id: 'denoise',
      label: 'Noise Suppression',
      tooltip:
        'Run the OpenVINO noise-suppression model over the audio before transcribing (OpenVINO Model Server backend).',
      checked: useDenoise,
      onChange: setUseDenoise,
    })
  }

  return { values, params }
}
