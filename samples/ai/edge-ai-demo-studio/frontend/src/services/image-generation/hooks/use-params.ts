// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { useDemoParams } from '@/services/common/demo/use-demo-params'

const IMAGE_GEN_DEFAULTS = {
  steps: 30,
  cfgScale: 7.5,
  resolution: '512x512',
  strength: 0.75,
}

/**
 * Turbo models are distilled for a few steps without guidance; at 30 steps and CFG 7.5 they burn
 * out to white. CFG 1 turns guidance off, which the worker's NPU turbo pipeline is built for.
 */
const TURBO_DEFAULTS = { steps: 4, cfgScale: 1 }

function modelDefaults(model: string) {
  return /turbo/i.test(model) ? TURBO_DEFAULTS : undefined
}

interface UseImageGenParamsOptions {
  /** The model the settings are for: turbo models start from their own. */
  model: string
  /** Offer Strength (image-to-image only). */
  showStrength?: boolean
  /** Under a `DemoSessionProvider`, keeps the settings per instance across remounts. */
  sessionKey?: string
}

export function useImageGenParams({
  model,
  showStrength = false,
  sessionKey,
}: UseImageGenParamsOptions) {
  const { values, setters } = useDemoParams(IMAGE_GEN_DEFAULTS, {
    sessionKey,
    initial: modelDefaults(model),
  })

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'steps',
      label: 'Steps',
      tooltip:
        'Denoising iteration count. Higher values increase quality and generation time.',
      value: values.steps,
      min: 1,
      max: 100,
      step: 1,
      onChange: setters.setSteps,
    },
    {
      type: 'slider',
      id: 'cfg_scale',
      label: 'CFG Scale',
      tooltip:
        'Controls how closely the model follows the text prompt. Higher values produce more prompt-aligned results.',
      value: values.cfgScale,
      min: 1,
      max: 20,
      step: 0.5,
      onChange: setters.setCfgScale,
    },
    {
      type: 'select',
      id: 'resolution',
      label: 'Resolution',
      value: values.resolution,
      options: [
        { value: '512x512', label: '512 × 512' },
        { value: '768x768', label: '768 × 768' },
        { value: '1024x1024', label: '1024 × 1024' },
      ],
      onChange: setters.setResolution,
    },
    ...(showStrength
      ? [
          {
            type: 'slider' as const,
            id: 'strength',
            label: 'Strength',
            tooltip:
              'How much to transform the source image. 0.0 keeps the original, 1.0 fully replaces it.',
            value: values.strength,
            min: 0.0,
            max: 1.0,
            step: 0.05,
            onChange: setters.setStrength,
          },
        ]
      : []),
  ]

  return { values, params }
}
