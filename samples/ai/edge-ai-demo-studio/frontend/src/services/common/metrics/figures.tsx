// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Live metrics figures shared by several services, named as benchmarks name them, each for the
 * latest call. A figure only one service uses lives in its `metrics.tsx`.
 */

import { formatCompactNumber, formatDurationMs } from '@/lib/browser/format'
import type { MeasuredWork } from './types'
import { rate, workMs } from './calc'
import { StatTile } from './stat-tile'
import type { MetricFigure } from './types'

/** `38.2` under a hundred, compact (`1.2K`) beyond, `0.42` under one. */
export function formatRate(value: number): string {
  if (value >= 100) return formatCompactNumber(Math.round(value))
  return value >= 1 ? value.toFixed(1) : value.toFixed(2)
}

/** Joins the parts of a tile's detail line, dropping the empty ones. */
export function detailLine(
  ...parts: (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(' · ')
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `9.5×`, `12.4×`, `120×`. */
function formatSpeed(value: number): string {
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}×`
}

/** `2.9` from ten a second down, `24` above. */
function formatFps(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1)
}

/** `13 inputs in 120 ms`: how much the work handled, in the time it took. */
function handled(work: MeasuredWork | null, unit: string): string | null {
  const items = work?.quantities.items
  const ms = work ? workMs(work) : undefined
  return items === undefined || ms === undefined
    ? null
    : `${formatCompactNumber(items)} ${unit} in ${formatDurationMs(ms)}`
}

/** The response time the demo measured, the hop through the app included. */
const responseMs = (work: MeasuredWork) => work.responseMs

/**
 * The latest call's time: the worker-reported model or job time, else the demo's response time
 * (always that with `source: 'response'`). Without a `label`, named after where the time came from.
 */
export function latency({
  label,
  source: fixedSource,
}: { label?: string; source?: 'response' } = {}): MetricFigure {
  const timeOf = fixedSource === 'response' ? responseMs : workMs
  return {
    id: 'latency',
    render: (work) => {
      const ms = work ? timeOf(work) : undefined
      const source =
        fixedSource ??
        (work?.reported
          ? 'job'
          : work?.inferenceMs !== undefined
            ? 'inference'
            : 'response')
      return (
        <StatTile
          id="latency"
          label={
            label ??
            {
              job: 'Processing time',
              inference: 'Inference time',
              response: 'Latency',
            }[source]
          }
          value={ms === undefined ? '—' : formatDurationMs(ms)}
          detail={
            source === 'inference' && work?.responseMs !== undefined
              ? `${formatDurationMs(work.responseMs)} through the app`
              : 'Latest request'
          }
          tip={
            {
              job: 'Time the worker spent on the latest job it finished, as it reports it — the request itself returns at once and the demo follows the job.',
              inference:
                'Time the worker spent in the model for the latest request, as it reports it — without the hop through the app, which the detail line includes.',
              response:
                'Time from sending the latest request to the worker until its response finished, including the hop through the app.',
            }[source]
          }
        />
      )
    },
  }
}

/** Seconds of audio per second of processing (`audioSeconds`), with the RTF. */
export function rtfx(): MetricFigure {
  return {
    id: 'rtfx',
    render: (work) => {
      const speed = rate(work, 'audioSeconds')
      const audio = work?.quantities.audioSeconds
      return (
        <StatTile
          id="rtfx"
          label="RTFx"
          value={speed === null ? '—' : formatSpeed(speed)}
          detail={
            speed === null
              ? 'Seconds of audio per second'
              : detailLine(
                  `RTF ${(1 / speed).toFixed(2)}`,
                  audio !== undefined &&
                    `${formatDurationMs(audio * 1000)} of audio`,
                )
          }
          tip="Seconds of audio handled per second of processing, for the latest request: 12× means a minute of audio takes five seconds. RTF is its inverse — the real-time factor, processing time over audio length — where below 1 is faster than real time."
        />
      )
    },
    headline: (work) => {
      const speed = rate(work, 'audioSeconds')
      return speed === null ? null : `RTFx ${formatSpeed(speed)}`
    },
  }
}

/** Frames (`items`) per second of processing. */
export function fps(): MetricFigure {
  return {
    id: 'fps',
    render: (work) => {
      const speed = rate(work, 'items')
      return (
        <StatTile
          id="fps"
          label="FPS"
          value={speed === null ? '—' : formatFps(speed)}
          detail={
            (speed !== null && handled(work, 'frames')) || 'Frames per second'
          }
          tip="Frames the model got through per second of processing, for the latest request. Requests sent concurrently can push the real rate above it."
        />
      )
    },
    headline: (work) => {
      const speed = rate(work, 'items')
      return speed === null ? null : `${formatFps(speed)} FPS`
    },
  }
}

/** Units of work (`items`) per second of processing; `unit` names them, plural. */
export function throughput({ unit }: { unit: string }): MetricFigure {
  return {
    id: 'throughput',
    render: (work) => {
      const speed = rate(work, 'items')
      return (
        <StatTile
          id="throughput"
          label="Throughput"
          value={speed === null ? '—' : `${formatRate(speed)} /s`}
          detail={
            (speed !== null && handled(work, unit)) ||
            `${capitalize(unit)} per second`
          }
          tip={`${capitalize(unit)} handled per second of processing, for the latest request.`}
        />
      )
    },
    headline: (work) => {
      const speed = rate(work, 'items')
      return speed === null ? null : `${formatRate(speed)} ${unit}/s`
    },
  }
}
