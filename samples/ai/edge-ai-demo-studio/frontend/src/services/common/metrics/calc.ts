// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Pure figures of one `MeasuredWork` (time, rates), so every `metrics.tsx` computes them alike. */

import type { MeasuredWork } from './types'

/** The work's time as the worker or job reported it, else the demo's response time. */
export function workMs(work: MeasuredWork): number | undefined {
  return work.inferenceMs ?? work.responseMs
}

/**
 * What a rate is over: all the work, up to its first output (prefill) or after it (decoding).
 * Unstreamed work has neither part, rather than a decode span that hides the prefill.
 */
type RateSpan = 'work' | 'to-first-output' | 'after-first-output'

function spanMs(work: MeasuredWork, span: RateSpan): number | undefined {
  const total = workMs(work)
  switch (span) {
    case 'work':
      return total
    case 'to-first-output':
      return work.firstOutputMs
    case 'after-first-output':
      return total === undefined || work.firstOutputMs === undefined
        ? undefined
        : total - work.firstOutputMs
  }
}

/** `quantity` per second of `span` (`audioSeconds` gives the RTFx), or `null` when either is missing. */
export function rate(
  work: MeasuredWork | null,
  quantity: string,
  span: RateSpan = 'work',
): number | null {
  const value = work?.quantities[quantity]
  const ms = work ? spanMs(work, span) : undefined
  return value && ms !== undefined && ms > 0 ? value / (ms / 1000) : null
}
