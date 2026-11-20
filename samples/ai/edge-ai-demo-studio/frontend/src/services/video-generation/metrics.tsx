// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatDurationMs } from '@/lib/browser/format'
import { rate, workMs } from '@/services/common/metrics/calc'
import { StatTile } from '@/services/common/metrics/stat-tile'
import type { MetricFigure } from '@/services/common/metrics/types'

const generationTime: MetricFigure = {
  id: 'generation-time',
  render: (work) => {
    const ms = work ? workMs(work) : undefined
    const frames = work?.quantities.frames
    return (
      <StatTile
        id="generation-time"
        label="Generation time"
        value={ms === undefined ? '—' : formatDurationMs(ms)}
        detail={frames ? `${frames} frames` : 'Per video'}
        tip="Time the latest video took on the worker, from its start to the finished MP4 (time queued behind other videos is not counted)."
      />
    )
  },
  headline: (work) => {
    const ms = work ? workMs(work) : undefined
    return ms === undefined ? null : `${formatDurationMs(ms)} per video`
  },
}

const framesPerSecond: MetricFigure = {
  id: 'frames-per-second',
  render: (work) => {
    const speed = rate(work, 'frames')
    return (
      <StatTile
        id="frames-per-second"
        label="Frames/s"
        value={speed === null ? '—' : speed.toFixed(2)}
        detail="Video frames made per second"
        tip="Frames of the latest video divided by the time it took: how close generation is to real time."
      />
    )
  },
}

const stepsPerSecond: MetricFigure = {
  id: 'steps',
  render: (work) => {
    const speed = rate(work, 'steps')
    const steps = work?.quantities.steps
    return (
      <StatTile
        id="steps"
        label="it/s"
        value={speed === null ? '—' : speed.toFixed(2)}
        detail={
          steps === undefined ? 'Denoising steps per second' : `${steps} steps`
        }
        tip="Denoising steps of the latest video per second of its whole time (prompt, steps, decoding and encoding)."
      />
    )
  },
}

export const figures: MetricFigure[] = [
  generationTime,
  framesPerSecond,
  stepsPerSecond,
]
