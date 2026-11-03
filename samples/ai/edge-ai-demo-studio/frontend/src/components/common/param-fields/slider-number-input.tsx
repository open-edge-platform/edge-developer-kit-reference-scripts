// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import type { ParamSlider } from '@/types/demo-params'
import { toSliderValue } from './slider-value'

/**
 * Typed value for a slider: applied while it is in range, clamped and
 * rounded to the step when the field loses focus.
 */
export function SliderNumberInput({ param }: { param: ParamSlider }) {
  const [draft, setDraft] = useState<string | null>(null)
  const typed = draft === null ? param.value : Number(draft)
  const invalid =
    draft !== null &&
    (draft.trim() === '' ||
      !Number.isFinite(typed) ||
      typed < param.min ||
      typed > param.max ||
      toSliderValue(typed, param) !== typed)

  const commit = () => {
    if (draft === null) return
    const value = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(value)) {
      param.onChange(toSliderValue(value, param))
    }
    setDraft(null)
  }

  return (
    <Input
      type="number"
      inputMode="decimal"
      min={param.min}
      max={param.max}
      step={param.step}
      value={draft ?? String(param.value)}
      aria-label={`${param.label} value`}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const next = e.target.value
        setDraft(next)
        const value = Number(next)
        if (
          next.trim() !== '' &&
          Number.isFinite(value) &&
          value >= param.min &&
          value <= param.max
        ) {
          param.onChange(value)
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      className="h-8 w-24 px-2 text-xs tabular-nums md:text-xs"
    />
  )
}
