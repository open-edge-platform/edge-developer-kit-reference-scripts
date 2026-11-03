// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'

/**
 * What a unit of model work handled, by camelCase name (e.g. `{ audioSeconds: 4.2 }`). Names are
 * open; only the service's `metrics.tsx` gives them a meaning.
 */
export type MetricsQuantities = Record<string, number>

/** One unit of model work a demo sent that completed successfully. */
export interface MeasuredWork {
  /** When it finished, epoch ms. */
  at: number
  /** Request sent to answer finished as the demo measured it, ms; absent if only the worker timed it. */
  responseMs?: number
  /** Time the worker reported for the work itself (model call, job, utterance), ms. */
  inferenceMs?: number
  /** Time to the first output (token) of a streamed answer, ms. */
  firstOutputMs?: number
  quantities: MetricsQuantities
  /** A finished background job, timed by the worker. */
  reported?: true
}

/** One figure of a service's Live metrics panel (its `metrics.tsx` `figures`), from the latest work. */
export interface MetricFigure {
  /** Unique within the service; the tile's test id is `metric-<id>`. */
  id: string
  /** The figure's tile for the latest work; `null` until there is some. */
  render(work: MeasuredWork | null): ReactNode
  /** One line for the collapsed panel, or `null` if the work lacks it; the first figure's is shown. */
  headline?(work: MeasuredWork): string | null
}
