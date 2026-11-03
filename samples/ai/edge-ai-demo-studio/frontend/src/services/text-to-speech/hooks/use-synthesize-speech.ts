// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useGetService } from '@/context/service-status-context'
import { getEffectiveModel } from '@/types/service'
import { DEFAULT_TTS_MODEL } from '../config'
import { requestSpeech } from '../lib/speech-request'
import type { SpeechRequestParams } from '../lib/tts-models'

/** The model the TTS instance serves, which shapes the request. */
export function useTtsModel(): string {
  const ttsService = useGetService('text-to-speech')
  return (ttsService && getEffectiveModel(ttsService).name) || DEFAULT_TTS_MODEL
}

/** Whole-file synthesis as a plain function, for callers that run several at once or cancel. */
export function useSpeechSynthesizer(apiBase: string | undefined) {
  const currentModel = useTtsModel()

  return async (
    params: SpeechRequestParams,
    signal?: AbortSignal,
  ): Promise<Blob> => {
    const res = await requestSpeech(apiBase, currentModel, params, signal)
    return res.blob()
  }
}
