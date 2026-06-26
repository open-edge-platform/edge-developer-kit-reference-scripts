// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

const IMAGE_GEN_DEFAULTS = {
  steps: 30,
  cfgScale: 7.5,
  resolution: '512x512',
  strength: 0.75,
}

export interface ImageGenParamValues {
  steps: number
  cfgScale: number
  resolution: string
  strength: number
}

export function useImageGenParams(
  options?: { showStrength?: boolean },
  initial?: Partial<ImageGenParamValues>,
): { values: ImageGenParamValues; params: DemoParam[] } {
  const [steps, setSteps] = useState(initial?.steps ?? IMAGE_GEN_DEFAULTS.steps)
  const [cfgScale, setCfgScale] = useState(
    initial?.cfgScale ?? IMAGE_GEN_DEFAULTS.cfgScale,
  )
  const [resolution, setResolution] = useState(
    initial?.resolution ?? IMAGE_GEN_DEFAULTS.resolution,
  )
  const [strength, setStrength] = useState(
    initial?.strength ?? IMAGE_GEN_DEFAULTS.strength,
  )

  const values: ImageGenParamValues = { steps, cfgScale, resolution, strength }

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'steps',
      label: 'Steps',
      tooltip:
        'Denoising iteration count. Higher values increase quality and generation time.',
      value: steps,
      min: 1,
      max: 100,
      step: 1,
      onChange: setSteps,
    },
    {
      type: 'slider',
      id: 'cfg_scale',
      label: 'CFG Scale',
      tooltip:
        'Controls how closely the model follows the text prompt. Higher values produce more prompt-aligned results.',
      value: cfgScale,
      min: 1,
      max: 20,
      step: 0.5,
      onChange: setCfgScale,
    },
    {
      type: 'select',
      id: 'resolution',
      label: 'Resolution',
      value: resolution,
      options: [
        { value: '512x512', label: '512 × 512' },
        { value: '768x768', label: '768 × 768' },
        { value: '1024x1024', label: '1024 × 1024' },
      ],
      onChange: setResolution,
    },
    ...(options?.showStrength
      ? [
          {
            type: 'slider' as const,
            id: 'strength',
            label: 'Strength',
            tooltip:
              'How much to transform the source image. 0.0 keeps the original, 1.0 fully replaces it.',
            value: strength,
            min: 0.0,
            max: 1.0,
            step: 0.05,
            onChange: setStrength,
          },
        ]
      : []),
  ]

  return { values, params }
}
