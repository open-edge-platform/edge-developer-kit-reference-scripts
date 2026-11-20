// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useDemoParams } from '@/services/common/demo/use-demo-params'
import type { DemoParam } from '@/types/demo-params'
import { framesFor, getVideoModelSpec } from '../config'

interface UseVideoGenParamsOptions {
  /** The model the settings are for: each starts from its own size, steps and guidance. */
  model: string
  /** Under a `DemoSessionProvider`, keeps the settings per instance across remounts. */
  sessionKey?: string
}

export function useVideoGenParams({
  model,
  sessionKey,
}: UseVideoGenParamsOptions) {
  const spec = getVideoModelSpec(model)
  const maxSeconds = (spec.maxFrames - 1) / spec.fps
  const { values, setters } = useDemoParams(
    {
      size: spec.sizes[0].value,
      seconds: 2,
      steps: spec.defaultSteps,
      guidance: spec.defaultGuidance,
      previews: true,
    },
    { sessionKey },
  )
  // Settings kept from before the field existed have none: on.
  const previews = values.previews !== false
  // A size or length kept from another model's settings falls back to this model's.
  const size = spec.sizes.some((s) => s.value === values.size)
    ? values.size
    : spec.sizes[0].value
  const seconds = Math.min(values.seconds, maxSeconds)
  const numFrames = framesFor(seconds, spec)

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'size',
      label: 'Resolution',
      tooltip: spec.windowed
        ? 'Width × height. The first is what the model was trained at; smaller ones are faster for trying prompts. Larger ones are made a few frames at a time in overlapping windows, so they take several times longer.'
        : 'Width × height. The first is what the model was trained at; smaller ones are faster for trying prompts.',
      value: size,
      options: spec.sizes,
      onChange: setters.setSize,
    },
    {
      type: 'slider',
      id: 'seconds',
      label: 'Duration',
      tooltip: spec.windowed
        ? `Length of the video, ${numFrames} frames at ${spec.fps} fps. Past 5 s it is made in overlapping windows, so time grows in steps with the length: a 30 s video takes several times a 5 s one.`
        : `Length of the video, ${numFrames} frames at ${spec.fps} fps. Time grows a little faster than length.`,
      value: seconds,
      min: 0.5,
      max: maxSeconds,
      step: 0.5,
      unit: 's',
      onChange: setters.setSeconds,
    },
    ...(spec.fixedSteps === null
      ? [
          {
            type: 'slider' as const,
            id: 'steps',
            label: 'Steps',
            tooltip:
              'Denoising steps. More give more detail and take proportionally longer; the model was tuned for 50.',
            value: values.steps,
            min: 4,
            max: 60,
            step: 1,
            onChange: setters.setSteps,
          },
          {
            type: 'slider' as const,
            id: 'guidance',
            label: 'Guidance scale',
            tooltip:
              'How closely the video follows the prompt. Each step runs the model twice above 1.',
            value: values.guidance,
            min: 1,
            max: 10,
            step: 0.5,
            advanced: true,
            onChange: setters.setGuidance,
          },
        ]
      : []),
    {
      type: 'toggle',
      id: 'previews',
      label: 'Show each step',
      tooltip:
        "Decodes the model's guess at the video after every denoising step into a small clip, shown as it goes and kept to scrub through. Adds a few percent to the time on a GPU, more on a CPU.",
      checked: previews,
      onChange: setters.setPreviews,
    },
  ]

  return {
    values: {
      size,
      numFrames,
      steps: spec.fixedSteps ?? values.steps,
      guidance: spec.fixedSteps === null ? values.guidance : undefined,
      previews,
    },
    params,
    spec,
    /** Picks the resolution, as its select does (the pose tab follows the driving video's shape). */
    setSize: setters.setSize,
  }
}
