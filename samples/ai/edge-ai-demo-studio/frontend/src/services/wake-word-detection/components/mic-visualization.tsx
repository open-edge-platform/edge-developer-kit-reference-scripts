// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The microphone, with rings that grow with the input level and a flash on a detection. */
export function MicVisualization({
  isDetecting,
  audioLevel,
  detected,
}: {
  isDetecting: boolean
  /** RMS input level, 0–1. */
  audioLevel: number
  detected: boolean
}) {
  const hasAudio = audioLevel > 0.01
  return (
    <div
      aria-hidden="true"
      className="relative flex items-center justify-center"
    >
      {isDetecting && hasAudio && (
        <>
          <div
            className="border-primary/20 absolute rounded-full border-2 transition-all duration-150"
            style={{
              width: `${80 + audioLevel * 200}px`,
              height: `${80 + audioLevel * 200}px`,
              opacity: Math.min(audioLevel * 5, 0.6),
            }}
          />
          <div
            className="border-primary/30 absolute rounded-full border-2 transition-all duration-150"
            style={{
              width: `${80 + audioLevel * 120}px`,
              height: `${80 + audioLevel * 120}px`,
              opacity: Math.min(audioLevel * 8, 0.8),
            }}
          />
        </>
      )}
      {detected && (
        <div className="bg-success/20 absolute h-28 w-28 animate-ping rounded-full [animation-duration:0.6s]" />
      )}
      <div
        className={cn(
          'relative flex h-20 w-20 items-center justify-center rounded-full transition-all',
          isDetecting
            ? 'bg-primary/15 text-primary ring-primary/20 ring-4'
            : 'bg-muted/50 text-muted-foreground',
          detected && 'bg-success/15 text-success ring-success/40 ring-4',
        )}
      >
        {isDetecting ? (
          <Mic className="h-8 w-8" />
        ) : (
          <MicOff className="h-8 w-8" />
        )}
      </div>
    </div>
  )
}
