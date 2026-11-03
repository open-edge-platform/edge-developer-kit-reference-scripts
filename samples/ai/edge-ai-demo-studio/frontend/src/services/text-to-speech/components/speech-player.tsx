// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Download, Pause, Play } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useObjectUrl } from '@/hooks/use-object-url'
import { formatClock } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { safeMediaSrc, MEDIA_SRC_CHARS } from '@/lib/validation'
import type { SpeechRequest } from '../lib/speech-synthesis'
import {
  getTtsCapabilities,
  getVoicesForModel,
  ttsFormatLabel,
} from '../lib/tts-models'

/** Decorative waveform; the played share is highlighted. */
const WAVEFORM_BARS = Array.from({ length: 60 }, (_, i) => ({
  id: `wave-${i}`,
  height:
    Math.sin(i * 0.3) * 20 +
    ((((i * 1103515245 + 12345) & 0x7fffffff) % 100) / 100) * 15 +
    10,
}))

/** What a synthesis was made with, from its own request rather than the controls. */
function describeRequest({ model, params }: SpeechRequest): string {
  const voice =
    getVoicesForModel(model).find((v) => v.id === params.voice)?.label ??
    params.voice
  return [
    voice && `Voice ${voice}`,
    getTtsCapabilities(model).speed && `Speed ${params.speed}×`,
    ttsFormatLabel(params.responseFormat),
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface LivePlayback {
  playing: boolean
  pause: () => void
  resume: () => void
  /** Seconds played and seconds received so far. */
  position: () => { currentTime: number; duration: number }
}

/** One synthesis, played live while it streams in, then from its finished file. */
export function SpeechPlayer({
  title,
  request,
  file,
  live,
  testId,
  children,
}: {
  title: string
  request: SpeechRequest
  file: Blob | null
  live: LivePlayback | null
  testId?: string
  children?: ReactNode
}) {
  const url = useObjectUrl(file)
  let safeSrc = ''
  for (const ch of safeMediaSrc(url)) {
    let ok = ''
    for (const allowed of MEDIA_SRC_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeSrc = ''
      break
    }
    safeSrc += ok
  }
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [filePlaying, setFilePlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const streaming = live !== null
  const position = live?.position
  const playing = live ? live.playing : filePlaying

  // Live playback has played out: the finished file starts from the top.
  const [wasStreaming, setWasStreaming] = useState(streaming)
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming)
    if (!streaming) setCurrentTime(0)
  }

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      if (position) {
        // The duration grows as the rest of the speech arrives.
        const now = position()
        setCurrentTime(now.currentTime)
        setDuration(now.duration)
      } else if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, position])

  const handlePlayPause = () => {
    if (live) {
      if (live.playing) live.pause()
      else live.resume()
      return
    }
    const audio = audioRef.current
    if (!audio) return
    if (filePlaying) audio.pause()
    // A play the browser refuses leaves the button on Play.
    else audio.play().catch(() => {})
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const playedBars = (progress / 100) * WAVEFORM_BARS.length
  const name = title.toLowerCase()

  return (
    <section
      aria-label={title}
      className="border-border bg-background/60 flex flex-col gap-3 rounded-lg border p-3"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-foreground text-xs font-semibold">{title}</h3>
          <p className="text-muted-foreground text-xs">
            {describeRequest(request)}
          </p>
        </div>
        {safeSrc && (
          <Button asChild variant="outline" size="sm">
            <a
              href={safeSrc}
              download={`speech.${request.params.responseFormat}`}
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              Download audio
            </a>
          </Button>
        )}
      </div>

      {safeSrc && (
        <audio
          ref={audioRef}
          src={safeSrc}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setFilePlaying(true)}
          onPause={() => setFilePlaying(false)}
          onEnded={() => {
            setFilePlaying(false)
            setCurrentTime(0)
          }}
        />
      )}

      <div aria-hidden="true" className="flex h-12 items-end gap-[2px] px-2">
        {WAVEFORM_BARS.map((bar, i) => (
          <div
            key={bar.id}
            className={cn(
              'flex-1 rounded-sm transition-colors duration-100',
              i < playedBars ? 'bg-primary' : 'bg-muted-foreground/20',
            )}
            style={{ height: `${bar.height}%` }}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="outline"
          className="h-10 w-10 rounded-full"
          onClick={handlePlayPause}
          disabled={!live && !safeSrc}
          aria-label={`${playing ? 'Pause' : 'Play'} ${name}`}
        >
          {playing ? (
            <Pause aria-hidden className="h-4 w-4" />
          ) : (
            <Play aria-hidden className="ml-0.5 h-4 w-4" />
          )}
        </Button>
        <Progress
          value={progress}
          aria-label={`${title} position`}
          className="h-1.5 flex-1"
        />
        <span className="text-muted-foreground min-w-[70px] text-right font-mono text-xs">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
      </div>
      {children}
    </section>
  )
}
