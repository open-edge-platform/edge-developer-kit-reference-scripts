// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import {
  useGetService,
  useServiceLiveStatus,
} from '@/context/service-status-context'
import {
  type TtsParamValues,
  useTtsParams as useServiceTtsParams,
} from '@/services/text-to-speech/hooks/use-params'
import { useTtsVoiceStatus } from '@/services/text-to-speech/hooks/use-voice-status'
import { ServiceParamGroup } from '../components/demo-config-sheet'

export type TtsParams = Pick<
  TtsParamValues,
  'voice' | 'speed' | 'format' | 'volume'
>

interface UseTtsParamsOptions {
  initial?: Partial<TtsParams>
  optional?: boolean
}

export function useTtsParams(sampleId: string, options?: UseTtsParamsOptions) {
  const { initial: _initial, optional = true } = options ?? {}
  const ttsService = useGetService('text-to-speech')
  const currentModel =
    ttsService?.currentModel ?? ttsService?.defaultModel?.name ?? 'kokoro'
  const { voiceMap } = useTtsVoiceStatus()
  const { values, params } = useServiceTtsParams(currentModel, voiceMap)
  const [enabled, setEnabled] = useState(true)

  const online = useServiceLiveStatus('text-to-speech') === 'online'

  // Apply initial overrides on first render (handled by service hook defaults)
  // The sample exposes only voice & speed for API calls
  const sampleValues: TtsParams = {
    voice: values.voice,
    speed: values.speed,
    format: values.format,
    volume: values.volume,
  }

  const group: ServiceParamGroup = {
    serviceLabel: 'Text to Speech',
    serviceId: 'text-to-speech',
    online,
    optional,
    ...(optional
      ? {
          offlineMessage:
            'Enable TTS to hear answers read aloud. Start the service from the configuration page.',
          configHref: `/samples/${sampleId}`,
          enabled,
          onToggle: setEnabled,
        }
      : {}),
    params,
  }

  return {
    values: sampleValues,
    online: optional ? online && enabled : online,
    group,
  }
}
