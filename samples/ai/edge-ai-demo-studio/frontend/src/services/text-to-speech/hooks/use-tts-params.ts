// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceApiBase } from '@/context/service-status-context'
import { useOptionalServiceGroup } from '@/hooks/use-optional-service-group'
import { useTtsDemoParams } from './use-params'
import { useTtsModel } from './use-synthesize-speech'
import { useTtsVoiceStatus } from './use-voice-status'

interface UseTtsParamsOptions {
  optional?: boolean
}

/** TTS as a sample feature: speech settings as a parameter group tied to the service status. */
export function useTtsParams(sampleId: string, options?: UseTtsParamsOptions) {
  const { optional = true } = options ?? {}
  const model = useTtsModel()
  const apiBase = useServiceApiBase('text-to-speech')
  const { voiceMap } = useTtsVoiceStatus(apiBase, { model })
  const { values, params } = useTtsDemoParams(model, voiceMap)

  const { enabled, group } = useOptionalServiceGroup({
    serviceId: 'text-to-speech',
    serviceLabel: 'Text to Speech',
    optional,
    ...(optional && {
      offlineMessage:
        'Enable TTS to hear answers read aloud. Start the service from the configuration page.',
      configHref: `/samples/${sampleId}`,
    }),
    params,
  })

  return { values, online: enabled, group }
}
