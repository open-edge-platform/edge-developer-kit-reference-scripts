// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Mic, MicOff, Square, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getMicErrorMessage } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { useTranscribe } from './hooks'
import { useSttParams } from './hooks/use-params'

const PROCESSING_BAR_HEIGHTS = [
  6, 10, 14, 18, 22, 18, 14, 10, 8, 12, 16, 20, 16, 12, 8, 6, 10, 14, 18, 14,
  10, 8, 6, 4,
]
const PROCESSING_ANIM_DURATIONS = [
  0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3,
  0.6, 0.4, 0.5, 0.3, 0.6, 0.4, 0.5, 0.3, 0.4,
]

export function SpeechToTextDemo(_props: { service: Service }) {
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [recordDuration, setRecordDuration] = useState(0)
  const [barHeights, setBarHeights] = useState<number[]>(() =>
    Array(24).fill(4),
  )

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const smoothedDataRef = useRef<Float32Array>(new Float32Array(24))

  const transcribeMutation = useTranscribe()
  const { values: sttValues, params } = useSttParams()

  const bars = useMemo(
    () => Array.from({ length: 24 }, (_, i) => `bar-${i}`),
    [],
  )

  const startRecording = async () => {
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        for (const t of stream.getTracks()) t.stop()
        transcribeMutation.mutate({
          file: blob,
          language: sttValues.language,
          useDenoise: sttValues.useDenoise === 'true',
        })
      }

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      analyserRef.current = analyser
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const loop = () => {
        if (!analyserRef.current) return
        const freqData = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(freqData)
        const heights: number[] = []
        for (let i = 0; i < 24; i++) {
          const startBin = Math.floor((i * 32) / 24)
          const endBin = Math.max(startBin + 1, Math.floor(((i + 1) * 32) / 24))
          let sum = 0
          for (let b = startBin; b < endBin; b++) sum += freqData[b]
          const avg = sum / (endBin - startBin)
          smoothedDataRef.current[i] += (avg - smoothedDataRef.current[i]) * 0.3
          heights.push(4 + (smoothedDataRef.current[i] / 255) * 52)
        }
        setBarHeights(heights)
        animFrameRef.current = requestAnimationFrame(loop)
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordDuration(0)
      durationRef.current = setInterval(() => {
        setRecordDuration((d) => d + 100)
      }, 100)
      animFrameRef.current = requestAnimationFrame(loop)
    } catch (error) {
      setMicError(getMicErrorMessage(error))
    }
  }

  const stopRecording = () => {
    setIsRecording(false)
    if (durationRef.current) clearInterval(durationRef.current)
    durationRef.current = null
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    smoothedDataRef.current.fill(0)
    setBarHeights(Array(24).fill(4))
    mediaRecorderRef.current?.stop()
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    transcribeMutation.mutate({
      file,
      language: sttValues.language,
      useDenoise: sttValues.useDenoise === 'true',
    })
    e.target.value = ''
  }

  useEffect(() => {
    return () => {
      if (durationRef.current) clearInterval(durationRef.current)
      const tracks = mediaRecorderRef.current?.stream?.getTracks()
      if (tracks) for (const t of tracks) t.stop()
      if (animFrameRef.current !== null)
        cancelAnimationFrame(animFrameRef.current)
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [])

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const ms2 = Math.floor((ms % 1000) / 100)
    return `0:${s.toString().padStart(2, '0')}.${ms2}`
  }

  const isProcessing = transcribeMutation.isPending

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Audio Input</p>
            <div className="border-border bg-muted/20 flex flex-col items-center justify-center rounded-xl border p-8">
              {micError && (
                <div className="text-destructive mb-4 flex items-center gap-2 text-xs">
                  <MicOff className="h-3.5 w-3.5 shrink-0" />
                  <span>{micError}</span>
                </div>
              )}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full transition-all',
                  isRecording
                    ? 'scale-110 bg-red-500/20 text-red-400 ring-4 ring-red-500/30'
                    : 'bg-primary/15 text-primary hover:bg-primary/25',
                  isProcessing && 'cursor-not-allowed opacity-50',
                )}
              >
                {isRecording ? (
                  <Square className="h-7 w-7" />
                ) : (
                  <Mic className="h-8 w-8" />
                )}
              </button>

              <p className="text-muted-foreground mt-3 text-sm">
                {isRecording
                  ? `Recording... ${formatDuration(recordDuration)}`
                  : isProcessing
                    ? 'Transcribing...'
                    : 'Click to start recording'}
              </p>

              <div className="mt-4 flex h-12 items-end gap-[3px]">
                {bars.map((barId, i) => (
                  <div
                    key={barId}
                    className={cn(
                      'w-1 rounded-full transition-all duration-150',
                      isRecording
                        ? 'bg-red-400'
                        : isProcessing
                          ? 'bg-secondary'
                          : 'bg-muted-foreground/20',
                    )}
                    style={{
                      height: isRecording
                        ? `${barHeights[i]}px`
                        : isProcessing
                          ? `${PROCESSING_BAR_HEIGHTS[i]}px`
                          : '4px',
                      transition: isRecording ? 'none' : undefined,
                      animation: isProcessing
                        ? `pulse-status ${PROCESSING_ANIM_DURATIONS[i]}s ease-in-out infinite`
                        : 'none',
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant={isRecording ? 'destructive' : 'outline'}
                className="flex-1 gap-2"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
              >
                {isRecording ? (
                  <>
                    <Square className="h-4 w-4" />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    Record
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={isRecording || isProcessing}
                asChild
              >
                <label>
                  <Upload className="h-4 w-4" />
                  Upload
                  <input
                    data-testid="stt-file-input"
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">
                Transcription
              </p>
              {transcribeMutation.isSuccess && (
                <Badge variant="secondary" className="text-[10px]">
                  Completed
                </Badge>
              )}
            </div>
            <div
              className={cn(
                'border-border bg-muted/20 min-h-[260px] overflow-auto rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap',
                transcribeMutation.data?.text
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {isProcessing && (
                <div className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Transcribing audio...
                </div>
              )}
              {transcribeMutation.isError && (
                <p className="text-destructive">
                  Error: {transcribeMutation.error.message}
                </p>
              )}
              {transcribeMutation.isSuccess && (
                <span data-testid="stt-result-text">
                  {transcribeMutation.data.text ||
                    'No speech detected in the audio.'}
                </span>
              )}
              {transcribeMutation.isIdle &&
                'Transcription will appear here after recording...'}
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
