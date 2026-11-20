// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { StepPreview } from '../lib/video-job'

/** One position of the step slider: a step's preview, or the finished video after the last step. */
export interface StepSource {
  step: number
  src: string
  final: boolean
}

/** The previews, then the video itself as the last step once it is made. */
export function stepSources(
  previews: StepPreview[],
  video?: { src: string; steps: number | null },
): StepSource[] {
  const sources = previews.map((p) => ({
    step: p.step,
    src: p.url,
    final: false,
  }))
  if (video) {
    const last = previews.at(-1)?.step ?? 0
    sources.push({
      step: Math.max(video.steps ?? 0, last + 1),
      src: video.src,
      final: true,
    })
  }
  return sources
}

/**
 * Where the player was, carried to the next step's video so the steps are compared at the same
 * moment (and a paused frame stays paused).
 */
interface Playhead {
  time: number
  paused: boolean
}

/**
 * A step's video, or the finished one, with a slider over the steps below it when there are
 * previews (`children` go in the frame, over the video). Follows the last position until the slider
 * is moved back; moved to the end it follows again, so while the video is made it shows each new
 * step as it comes.
 */
export function StepView({
  sources,
  steps,
  making,
  dimmed,
  frameClassName,
  children,
}: {
  sources: StepSource[]
  /** Denoising steps of the video, when known. */
  steps: number | null
  /** The video is still being made: the last position is the latest step so far. */
  making: boolean
  /** Shown behind a newer request's progress. */
  dimmed?: boolean
  frameClassName: string
  children?: ReactNode
}) {
  const [pinned, setPinned] = useState<number | null>(null)
  const playhead = useRef<Playhead>({ time: 0, paused: false })
  const last = sources.length - 1
  const index = pinned === null ? last : Math.min(pinned, last)
  const shown = sources[index]
  const total = steps ?? sources.at(-1)?.step ?? null
  const of = total ? ` of ${total}` : ''

  const keep = (video: HTMLVideoElement) => {
    // The video just replaced still reports its pause and position: only the shown one counts.
    if (!video.isConnected) return
    playhead.current = { time: video.currentTime, paused: video.paused }
  }

  return (
    <>
      <div data-testid="videogen-output" className={frameClassName}>
        <video
          key={shown.src}
          src={shown.src}
          data-testid={shown.final ? 'videogen-video' : 'videogen-step-preview'}
          className={cn(
            'h-full w-full object-contain transition-opacity',
            dimmed && 'opacity-60',
          )}
          controls
          autoPlay
          loop
          muted
          playsInline
          // Small local blobs: loaded whole, so a step paused on shows its frame, not a spinner.
          preload="auto"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            const { time, paused } = playhead.current
            // Before autoplay starts: a frame paused on stays paused on the next step.
            if (paused) {
              video.autoplay = false
              video.pause()
            }
            if (
              time > 0 &&
              Number.isFinite(video.duration) &&
              video.duration > 0
            )
              video.currentTime = time % video.duration
          }}
          onTimeUpdate={(event) => keep(event.currentTarget)}
          onSeeked={(event) => keep(event.currentTarget)}
          onPlay={(event) => keep(event.currentTarget)}
          onPause={(event) => keep(event.currentTarget)}
        />
        {!shown.final && (
          <span
            data-testid="videogen-step-badge"
            className="bg-background text-foreground border-border absolute top-2 right-2 rounded-md border px-2 py-0.5 text-xs font-medium shadow-sm"
          >
            Step {shown.step}
            {of} · preview
          </span>
        )}
        {children}
      </div>

      {sources.some((source) => !source.final) && (
        <div className="space-y-2" data-testid="videogen-steps">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span
              id="videogen-steps-label"
              className="text-foreground font-medium"
            >
              Denoising steps
            </span>
            <span
              data-testid="videogen-step-label"
              className="text-muted-foreground font-mono tabular-nums"
            >
              Step {shown.step}
              {of}
              {shown.final
                ? ' · final video'
                : making && index === last
                  ? ' · latest'
                  : ''}
            </span>
          </div>
          {sources.length > 1 && (
            <Slider
              data-testid="videogen-steps-slider"
              aria-labelledby="videogen-steps-label"
              // Room for the thumb, which is taller than the track.
              className="py-2"
              min={0}
              max={last}
              step={1}
              value={[index]}
              onValueChange={([value]) =>
                setPinned(value >= last ? null : value)
              }
            />
          )}
          <p className="text-muted-foreground text-xs">
            {making
              ? "The model's guess at the finished video after each step, decoded small. Drag back to compare an earlier step at the same moment."
              : "Drag to watch the video take shape: each step is the model's guess at the finished video, decoded small; the last is the video itself."}
          </p>
        </div>
      )}
    </>
  )
}
