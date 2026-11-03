// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import type { InterpolationMode } from '../hooks'
import {
  useVideoMetadata,
  type VideoMetadata,
} from '../hooks/use-video-metadata'

/** `2.0 s`, or `1 min 05 s` from a minute on. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes} min ${String(rest).padStart(2, '0')} s`
}

/** `24 FPS`, `29.97 FPS`. */
function formatFps(fps: number): string {
  return `${Number.isInteger(fps) ? fps : Number(fps.toFixed(2))} FPS`
}

function describeSource({ durationS, fps, width, height }: VideoMetadata) {
  return [
    durationS !== null ? formatDuration(durationS) : 'length unknown',
    fps !== null ? formatFps(fps) : 'frame rate not detected',
    width && height ? `${width} × ${height}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * As the worker makes it: `multiplier - 1` new frames per pair, played at `multiplier ×` the frame
 * rate (Higher FPS) or at the source rate, so `multiplier ×` longer (Slow motion).
 */
function describeResult(
  { durationS, fps }: VideoMetadata,
  mode: InterpolationMode,
  multiplier: number,
): string {
  const outFps = fps !== null ? (mode === 'fps' ? fps * multiplier : fps) : null
  const outDuration =
    durationS !== null
      ? mode === 'fps'
        ? durationS
        : durationS * multiplier
      : null
  const frames =
    durationS !== null && fps !== null
      ? (Math.max(1, Math.round(durationS * fps)) - 1) * multiplier + 1
      : null
  return [
    outDuration !== null ? formatDuration(outDuration) : null,
    outFps !== null
      ? formatFps(outFps)
      : mode === 'fps'
        ? `${multiplier}× the source frame rate`
        : 'the source frame rate',
    frames !== null ? `about ${frames} frames` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function modeEffect(mode: InterpolationMode, multiplier: number) {
  return mode === 'fps'
    ? 'Same length with smoother motion. The audio is kept.'
    : `Plays ${multiplier}× slower at the same frame rate. The audio is dropped.`
}

/** The source video as the browser reads it, and the expected result, before any upload. */
export function InterpolationPreview({
  file,
  mode,
  multiplier,
}: {
  file: File
  mode: InterpolationMode
  multiplier: number
}) {
  const metadata = useVideoMetadata(file)

  if (metadata.isPending) {
    return (
      <p
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-xs"
      >
        <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        Reading the video’s length and frame rate…
      </p>
    )
  }

  if (metadata.isError) {
    return (
      <p className="text-muted-foreground text-xs" data-testid="fg-preview">
        This browser cannot read the video’s length and frame rate; the service
        reads them when it runs. {modeEffect(mode, multiplier)}
      </p>
    )
  }

  return (
    <dl
      className="bg-muted/30 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-xs"
      data-testid="fg-preview"
    >
      <dt className="text-muted-foreground">Source</dt>
      <dd className="text-foreground" data-testid="fg-preview-source">
        {describeSource(metadata.data)}
      </dd>
      <dt className="text-muted-foreground">Result</dt>
      <dd className="text-foreground" data-testid="fg-preview-result">
        {describeResult(metadata.data, mode, multiplier)}
      </dd>
    </dl>
  )
}
