// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import {
  useGetService,
  useServiceLiveStatus,
} from '@/context/service-status-context'
import {
  type TtsParamValues,
  useTtsParams as useServiceTtsParams,
} from './use-params'
import { useTtsVoiceStatus } from './use-voice-status'
import type { ServiceParamGroup } from '@/types/demo-params'

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
  const sampleValues: TtsParams = useMemo(
    () => ({
      voice: values.voice,
      speed: values.speed,
      format: values.format,
      volume: values.volume,
    }),
    [values.voice, values.speed, values.format, values.volume],
  )

  // Memoized so the text-to-speech feature provider can publish this group
  // through the collector without re-render churn (see docs/OPTIONAL-SERVICES.md).
  const group: ServiceParamGroup = useMemo(
    () => ({
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
    }),
    [online, optional, sampleId, enabled, params],
  )

  return {
    values: sampleValues,
    online: optional ? online && enabled : online,
    group,
  }
}
