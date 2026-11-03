// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatDurationMs } from '@/lib/browser/format'
import { rate, workMs } from '@/services/common/metrics/calc'
import { StatTile } from '@/services/common/metrics/stat-tile'
import type { MetricFigure } from '@/services/common/metrics/types'
import type { MeasuredWork } from '@/services/common/metrics/types'

/** Milliseconds per image of the work, or `null` without both. */
function msPerImage(work: MeasuredWork | null): number | null {
  const perSecond = rate(work, 'items')
  return perSecond === null ? null : 1000 / perSecond
}

const timePerImage: MetricFigure = {
  id: 'generation-time',
  render: (work) => {
    const each = msPerImage(work)
    const images = work?.quantities.items ?? 0
    const ms = work ? workMs(work) : undefined
    return (
      <StatTile
        id="generation-time"
        label="Generation time"
        value={each === null ? '—' : formatDurationMs(each)}
        detail={
          images > 1 && ms !== undefined
            ? `${images} images in ${formatDurationMs(ms)}`
            : 'Per image'
        }
        tip="Time the latest image took to generate, as the worker reports it: the processing time of the job divided by the images it produced."
      />
    )
  },
  headline: (work) => {
    const each = msPerImage(work)
    return each === null ? null : `${formatDurationMs(each)} per image`
  },
}

const stepsPerSec: MetricFigure = {
  id: 'steps',
  render: (work) => {
    const speed = rate(work, 'steps')
    const steps = work?.quantities.steps
    return (
      <StatTile
        id="steps"
        label="it/s"
        value={speed === null ? '—' : speed.toFixed(1)}
        detail={
          speed === null || steps === undefined
            ? 'Denoising steps per second'
            : `${steps} steps`
        }
        tip="Iterations (denoising steps) the model ran per second, for the latest generation — the speed diffusion benchmarks quote, independent of how many steps were asked for."
      />
    )
  },
}

export const figures: MetricFigure[] = [timePerImage, stepsPerSec]
