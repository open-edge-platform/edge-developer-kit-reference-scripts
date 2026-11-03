// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMicErrorMessage } from '@/lib/browser/media-utils'

export interface UseMediaRecorderOptions {
  /** Used only when `MediaRecorder.isTypeSupported` accepts it. */
  mimeType?: string
  /** Passed to `MediaRecorder.start()`; omit for one chunk at stop. */
  timesliceMs?: number
  /** Each non-empty chunk plus all chunks so far; not the final chunk a `stop()` flushes (see `onStop`). */
  onChunk?: (chunk: Blob, recorded: readonly Blob[]) => void
  onStop?: (blob: Blob) => void
}

export interface MediaRecorderStartResult {
  stream: MediaStream
  /** `performance.now()` at recording start, for aligning other timelines. */
  timeOrigin: number
}

export interface UseMediaRecorderResult {
  isRecording: boolean
  error: string | null
  start: () => Promise<MediaRecorderStartResult>
  stop: () => Promise<Blob>
  /** Discards buffered chunks without stopping. */
  clear: () => void
  clearError: () => void
}

/** `start()` was superseded (stop, newer start, unmount) while the mic opened; don't report it. */
export class RecordingCancelledError extends Error {
  override name = 'RecordingCancelledError'
}

/** A microphone `MediaRecorder` with its stream and chunks; tracks stop on `stop()` and unmount. */
export function useMediaRecorder(
  options: UseMediaRecorderOptions = {},
): UseMediaRecorderResult {
  const { mimeType, timesliceMs, onChunk, onStop } = options
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  // Refs, not `useEffectEvent`: the recorder's own event handlers call them, and effect events may
  // only be called from effects.
  const onStopRef = useRef(onStop)
  const onChunkRef = useRef(onChunk)
  useEffect(() => {
    onStopRef.current = onStop
    onChunkRef.current = onChunk
  }, [onStop, onChunk])

  // Stable on purpose: it is the unmount effect's dependency (a new identity would stop the mic
  // mid-recording), and callers put `start`/`stop` in their own effects.
  const releaseStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  // Bumped by start, stop and unmount: a start whose mic arrives after a newer one must not record.
  const attemptRef = useRef(0)

  const start = useCallback(async (): Promise<MediaRecorderStartResult> => {
    attemptRef.current += 1
    const attempt = attemptRef.current
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (attempt !== attemptRef.current) {
        for (const track of stream.getTracks()) track.stop()
        throw new RecordingCancelledError(
          'The recording was stopped before it started.',
        )
      }
      streamRef.current = stream

      const supportedMimeType =
        mimeType && MediaRecorder.isTypeSupported(mimeType)
          ? mimeType
          : undefined
      const mediaRecorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size === 0) return
        chunksRef.current.push(e.data)
        // The chunk a stop() flushes belongs to `onStop`'s whole recording.
        if (mediaRecorder.state === 'recording') {
          onChunkRef.current?.(e.data, chunksRef.current.slice())
        }
      }

      mediaRecorderRef.current = mediaRecorder
      const timeOrigin = performance.now()
      if (timesliceMs !== undefined) mediaRecorder.start(timesliceMs)
      else mediaRecorder.start()
      setIsRecording(true)
      return { stream, timeOrigin }
    } catch (err) {
      if (attempt === attemptRef.current) setError(getMicErrorMessage(err))
      throw err
    }
  }, [mimeType, timesliceMs])

  const stop = useCallback((): Promise<Blob> => {
    attemptRef.current += 1
    return new Promise<Blob>((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state !== 'recording') {
        releaseStream()
        setIsRecording(false)
        resolve(new Blob())
        return
      }

      recorder.addEventListener(
        'stop',
        () => {
          const blob = new Blob(chunksRef.current, {
            type: mimeType ?? (recorder.mimeType || 'audio/webm'),
          })
          releaseStream()
          setIsRecording(false)
          onStopRef.current?.(blob)
          resolve(blob)
        },
        { once: true },
      )
      recorder.stop()
    })
  }, [mimeType, releaseStream])

  const clear = useCallback(() => {
    chunksRef.current = []
  }, [])

  const clearError = useCallback(() => setError(null), [])

  useEffect(() => {
    return () => {
      attemptRef.current += 1
      const recorder = mediaRecorderRef.current
      if (recorder?.state === 'recording') recorder.stop()
      mediaRecorderRef.current = null
      releaseStream()
    }
  }, [releaseStream])

  return { isRecording, error, start, stop, clear, clearError }
}
