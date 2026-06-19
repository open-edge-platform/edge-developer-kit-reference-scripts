// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { useSynthesizeSpeech } from './hooks/use-synthesize-speech'
import { useTtsParams } from './hooks/use-params'
import { useTtsVoiceStatus } from './hooks/use-voice-status'

const DEFAULT_TEXT =
  'Welcome to the Edge AI Demo Studio. This text is being converted to natural sounding speech using the Kokoro text to speech model.'

export function TextToSpeechDemo({ service }: { service: Service }) {
  const currentModel =
    service.currentModel ?? service.defaultModel?.name ?? 'kokoro'
  const [input, setInput] = useState(DEFAULT_TEXT)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  const synthesizeMutation = useSynthesizeSpeech()

  const { voiceMap } = useTtsVoiceStatus()
  const { values: ttsValues, params } = useTtsParams(currentModel, voiceMap)

  const waveformBars = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: `wave-${i}`,
        height:
          Math.sin(i * 0.3) * 20 +
          ((((i * 1103515245 + 12345) & 0x7fffffff) % 100) / 100) * 15 +
          10,
      })),
    [],
  )

  const handleSynthesize = () => {
    if (!input.trim()) return
    setAudioUrl(null)
    setCurrentTime(0)
    setDuration(0)

    synthesizeMutation.mutate(
      {
        input: input.trim(),
        voice: ttsValues.voice,
        speed: ttsValues.speed,
        responseFormat: ttsValues.format,
        volumeMultiplier: ttsValues.volume,
      },
      {
        onSuccess: (blob) => {
          const url = URL.createObjectURL(blob)
          if (audioUrl) URL.revokeObjectURL(audioUrl)
          setAudioUrl(url)
        },
      },
    )
  }

  const handlePlayPause = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }

  useEffect(() => {
    if (!isPlaying) return
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        setCurrentTime(audio.currentTime)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying])

  // Clean up audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Text Input</p>
            <Textarea
              data-testid="tts-text-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter text to synthesize into speech..."
              rows={6}
              className="bg-muted/30 resize-none"
            />
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>{input.length} characters</span>
            </div>
            <Button
              data-testid="tts-synthesize-button"
              onClick={handleSynthesize}
              disabled={synthesizeMutation.isPending || !input.trim()}
              className="w-full gap-2"
            >
              {synthesizeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Synthesizing...
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4" />
                  Synthesize Speech
                </>
              )}
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Audio Output</p>
            <div className="border-border bg-muted/20 flex min-h-[200px] flex-col rounded-xl border p-4">
              {!audioUrl &&
                !synthesizeMutation.isPending &&
                !synthesizeMutation.isError && (
                  <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                    Synthesized audio will appear here...
                  </div>
                )}

              {synthesizeMutation.isPending && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3">
                  <Loader2 className="text-primary h-8 w-8 animate-spin" />
                  <p className="text-muted-foreground text-sm">
                    Generating audio...
                  </p>
                  <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                    <div className="bg-primary h-full w-2/3 animate-pulse rounded-full" />
                  </div>
                </div>
              )}

              {synthesizeMutation.isError && (
                <div className="text-destructive flex flex-1 items-center justify-center text-sm">
                  {synthesizeMutation.error.message}
                </div>
              )}

              {audioUrl && !synthesizeMutation.isPending && (
                <div
                  className="flex flex-1 flex-col gap-4"
                  data-testid="tts-audio-output"
                >
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onLoadedMetadata={(e) =>
                      setDuration(e.currentTarget.duration)
                    }
                    onEnded={() => {
                      setIsPlaying(false)
                      setCurrentTime(0)
                    }}
                  />

                  <div className="flex h-16 items-end gap-[2px] px-2">
                    {waveformBars.map((bar, i) => {
                      const playedPercent =
                        (progress / 100) * waveformBars.length
                      return (
                        <div
                          key={bar.id}
                          className={cn(
                            'flex-1 rounded-sm transition-colors duration-100',
                            i < playedPercent
                              ? 'bg-primary'
                              : 'bg-muted-foreground/20',
                          )}
                          style={{ height: `${bar.height}%` }}
                        />
                      )
                    })}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-10 w-10 rounded-full"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="ml-0.5 h-4 w-4" />
                      )}
                    </Button>
                    <div className="flex-1">
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full transition-all duration-100"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-muted-foreground min-w-[70px] text-right font-mono text-xs">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={params} />
      </div>
    </div>
  )
}
