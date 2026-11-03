// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState } from 'react'
import { getMicErrorMessage } from '@/lib/browser/media-utils'
import type { Service } from '@/services/types'
import {
  getSttVadThreshold,
  type SttBackendId,
  type SttVadSensitivity,
} from '../config'
import { isLiveSessionCancelled } from '../lib/live/live-session'
import {
  type LiveTranscript,
  NO_VOICE_ACTIVITY,
  type VoiceActivity,
} from '../lib/live/protocol'
import { useLiveStream } from './use-live-stream'

type LivePhase = 'idle' | 'starting' | 'active' | 'flushing'

/** Kept by a live session until it stops. */
interface LiveSessionSettings {
  language: string
  /** Silence, in seconds, that ends an utterance. */
  pauseSeconds: number
  vadSensitivity: SttVadSensitivity
}

/** Live mode of the STT demo: one session, its transcript, VAD state, and mic or session errors. */
export function useLiveTranscription(
  service: Service,
  { backend }: { backend: SttBackendId },
) {
  const live = useLiveStream(service)
  const [phase, setPhase] = useState<LivePhase>('idle')
  const [transcripts, setTranscripts] = useState<LiveTranscript[]>([])
  const [voice, setVoice] = useState<VoiceActivity>(NO_VOICE_ACTIVITY)
  const [error, setError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  // The latest `start`'s token, so an older session settling late can't touch a newer one's state.
  const attemptRef = useRef<object | null>(null)

  const start = async ({
    language,
    pauseSeconds,
    vadSensitivity,
  }: LiveSessionSettings) => {
    const attempt = {}
    attemptRef.current = attempt
    const isLatest = () => attemptRef.current === attempt
    setMicError(null)
    setError(null)
    setTranscripts([])
    setVoice(NO_VOICE_ACTIVITY)
    setPhase('starting')
    try {
      await live.start({
        language,
        backend,
        vad: {
          pauseSeconds,
          threshold: getSttVadThreshold(backend, vadSensitivity),
        },
        onTranscript: (t) => {
          if (isLatest()) setTranscripts((prev) => [...prev, t])
        },
        onVoiceActivity: (activity) => {
          if (isLatest()) setVoice(activity)
        },
        onError: (message) => {
          if (isLatest()) setError(message)
        },
        onDisconnect: (message) => {
          if (!isLatest()) return
          setPhase('idle')
          setError(message)
        },
      })
      if (isLatest()) setPhase('active')
    } catch (err) {
      if (!isLatest()) return
      setPhase('idle')
      // Stopped while it was still starting: nothing went wrong.
      if (!isLiveSessionCancelled(err)) setMicError(getMicErrorMessage(err))
    }
  }

  /** Stops listening; resolves once the last utterance is transcribed. */
  const stop = async () => {
    const attempt = attemptRef.current
    setPhase('flushing')
    await live.stop()
    if (attemptRef.current === attempt) setPhase('idle')
  }

  return {
    /** Listening, or opening the microphone and the socket to listen. */
    isActive: phase === 'active' || phase === 'starting',
    isStarting: phase === 'starting',
    isFlushing: phase === 'flushing',
    transcripts,
    /** What the worker's VAD hears; nothing unless listening. */
    voice: phase === 'active' ? voice : NO_VOICE_ACTIVITY,
    error,
    micError,
    stream: live.stream,
    start,
    stop,
    clearMicError: () => setMicError(null),
    /** Drops the last session's transcript and error, once it is over. */
    clear: () => {
      setTranscripts([])
      setError(null)
    },
  }
}
