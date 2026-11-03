// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useDemoParams } from '@/services/common/demo/use-demo-params'
import type { DemoParam } from '@/types/demo-params'

export const DIARIZATION_DEFAULTS = {
  unknownLabel: 'Unknown',
  speakerMatchThreshold: 0.5,
}

export interface DiarizationParamValues {
  unknownLabel: string
  speakerMatchThreshold: number
}

/** The diarization demo's sidebar parameters, kept per instance for the page visit by `sessionKey`. */
export function useDiarizationParams({
  sessionKey,
  initial,
}: { sessionKey?: string; initial?: Partial<DiarizationParamValues> } = {}): {
  values: DiarizationParamValues
  params: DemoParam[]
} {
  const { values, setters } = useDemoParams(DIARIZATION_DEFAULTS, {
    sessionKey,
    initial,
  })

  const params: DemoParam[] = [
    {
      type: 'textarea',
      id: 'unknown_label',
      label: 'Unknown Speaker Label',
      tooltip:
        'Only used with speaker profiles: the name given to voices that match none of them.',
      value: values.unknownLabel,
      placeholder: 'e.g. Unknown, Other, Guest',
      rows: 1,
      onChange: setters.setUnknownLabel,
    },
    {
      type: 'slider',
      id: 'speaker_match_threshold',
      label: 'Speaker Match Threshold',
      tooltip:
        'Only used with speaker profiles: the minimum cosine similarity to match a speaker to a profile. Lower values are more permissive.',
      value: values.speakerMatchThreshold,
      min: 0.1,
      max: 1.0,
      step: 0.05,
      onChange: setters.setSpeakerMatchThreshold,
    },
  ]

  return { values, params }
}
