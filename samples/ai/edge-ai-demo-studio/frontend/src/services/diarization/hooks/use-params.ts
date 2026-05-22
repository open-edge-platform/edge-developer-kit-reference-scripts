// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

export const DIARIZATION_DEFAULTS = {
  unknownLabel: 'Unknown',
  speakerMatchThreshold: 0.5,
}

export interface DiarizationParamValues {
  unknownLabel: string
  speakerMatchThreshold: number
}

export function useDiarizationParams(
  initial?: Partial<DiarizationParamValues>,
): {
  values: DiarizationParamValues
  params: DemoParam[]
} {
  const [unknownLabel, setUnknownLabel] = useState(
    initial?.unknownLabel ?? DIARIZATION_DEFAULTS.unknownLabel,
  )
  const [speakerMatchThreshold, setSpeakerMatchThreshold] = useState(
    initial?.speakerMatchThreshold ??
      DIARIZATION_DEFAULTS.speakerMatchThreshold,
  )

  const values: DiarizationParamValues = { unknownLabel, speakerMatchThreshold }

  const params: DemoParam[] = [
    {
      type: 'textarea',
      id: 'unknown_label',
      label: 'Unknown Speaker Label',
      value: unknownLabel,
      placeholder: 'e.g. Unknown, Other, Guest',
      rows: 1,
      onChange: setUnknownLabel,
    },
    {
      type: 'slider',
      id: 'speaker_match_threshold',
      label: 'Speaker Match Threshold',
      tooltip:
        'Minimum cosine similarity to match a speaker to a profile. Lower values are more permissive.',
      value: speakerMatchThreshold,
      min: 0.1,
      max: 1.0,
      step: 0.05,
      onChange: setSpeakerMatchThreshold,
    },
  ]

  return { values, params }
}
