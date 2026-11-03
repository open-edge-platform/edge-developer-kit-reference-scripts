// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ParamSlider } from '@/types/demo-params'

function stepDecimals(value: number): number {
  const [, fraction = ''] = String(value).split('.')
  return fraction.length
}

/** Clamps to the slider's range and rounds to its step. */
export function toSliderValue(value: number, param: ParamSlider): number {
  const { min, max, step } = param
  const clamped = Math.min(max, Math.max(min, value))
  const stepped =
    step > 0 ? Math.round((clamped - min) / step) * step + min : clamped
  const decimals = Math.max(stepDecimals(step), stepDecimals(min))
  return Number(Math.min(max, stepped).toFixed(decimals))
}
