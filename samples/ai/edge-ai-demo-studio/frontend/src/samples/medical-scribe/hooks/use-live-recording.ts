// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useGetService } from '@/context/service-status-context'
import { useElapsedMs } from '@/hooks/use-elapsed-ms'
import { RecordingCancelledError } from '@/hooks/use-media-recorder'
import { logger } from '@/lib/logger'
import {
  diarizationStreamProtocol,
  type LiveSpeakers,
} from '@/services/diarization/lib/live-protocol'
import {
  getRunningSttBackend,
  getServiceSttLanguageOptions,
  resolveSttLanguage,
} from '@/services/speech-to-text/config'
import { useLiveStream } from '@/services/speech-to-text/hooks/use-live-stream'
import { LiveCapture } from '@/services/speech-to-text/lib/live/live-capture'
import { sttProtocol } from '@/services/speech-to-text/lib/live/stt-protocol'
import { alignLiveUtterances } from '../lib/alignment'
import { speakerNaming } from '../lib/speaker-naming'
import type {
  DoctorProfile,
  LiveUtterance,
  Session,
  SessionUpdate,
} from '../lib/types'
import { useRecording } from './use-recording'

const NO_SPEAKERS: LiveSpeakers = {
  segments: [],
  coveredFrom: 0,
  coveredUntil: 0,
}

/**
 * How long transcription waits for the diarization socket before the audio starts without it.
 * Opening later, diarization joins at the next frame, still on the same timeline.
 */
const DIARIZATION_JOIN_TIMEOUT_MS = 3000

/**
 * Records a consultation with live transcription, reused as the transcript when processed. With
 * diarization on, the same captured samples also stream to the Diarization worker, whose VAD cuts
 * the same utterances, and the transcript is labelled by speaker as they are found. The recording
 * belongs to the session it started in, even if another one is selected meanwhile.
 */
export function useLiveRecording({
  updateSession,
  processAudio,
  diarizationEnabled,
  profiles,
}: {
  updateSession: (id: string, updates: SessionUpdate) => void
  processAudio: (
    sessionId: string,
    audio: Blob,
    knownDuration?: number,
    liveUtterances?: LiveUtterance[],
  ) => Promise<void>
  diarizationEnabled: boolean
  profiles: DoctorProfile[]
}) {
  const { isRecording, startRecording, stopRecording } = useRecording()
  // The type's primary instance: the running one, else the first.
  const sttService = useGetService('speech-to-text')
  const liveTranscription = useLiveStream(sttService)
  const diarizationService = useGetService('diarization')
  const liveDiarization = useLiveStream(diarizationService)
  // The live WebSocket follows the running worker's backend (/v1/realtime on OEP,
  // /v1/audio/stream on OVMS and MERaLiON), not a backend saved for the next start.
  const sttBackend = getRunningSttBackend(sttService)
  const recordingElapsedMs = useElapsedMs(isRecording)

  // The session the live transcript belongs to (kept after the recording
  // stops, while it is processed).
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  // From Record until the live capture holds the microphone (or has failed to).
  const [micStarting, setMicStarting] = useState(false)
  const [utterances, setUtterances] = useState<LiveUtterance[]>([])
  // The same utterances for `stop`, which runs in the click that ends the
  // recording, before a re-render could hand it the latest state.
  const utterancesRef = useRef<LiveUtterance[]>([])
  // The latest live diarization pass, kept after the recording stops (while it is processed).
  const [speakers, setSpeakers] = useState<LiveSpeakers>(NO_SPEAKERS)
  // Memoized by the React Compiler: re-aligned only when either changes.
  const liveTranscripts = alignLiveUtterances(
    utterances,
    speakers.segments,
    speakers.coveredFrom,
    speakers.coveredUntil,
  )

  const setUtterancesNow = (next: LiveUtterance[]) => {
    utterancesRef.current = next
    setUtterances(next)
  }

  /**
   * Streams the capture to the Diarization worker; resolves once its socket is open or has failed
   * (the transcript goes on without it).
   */
  const startLiveDiarization = (
    session: Session,
    timeOrigin: number,
    capture: LiveCapture,
  ): Promise<void> => {
    if (!diarizationEnabled || !diarizationService?.instancePort) {
      return Promise.resolve()
    }
    const profile = profiles.find((p) => p.id === session.doctorProfileId)
    return liveDiarization
      .start({
        timeOrigin,
        capture,
        protocol: diarizationStreamProtocol(
          speakerNaming(profile, { live: true }),
          (found) => {
            if (recordingSessionRef.current === session.id) setSpeakers(found)
          },
        ),
        onDisconnect: (message) =>
          logger.warn('Live diarization ended early:', message),
      })
      .catch((error: unknown) => {
        logger.warn(
          'Live diarization unavailable; labelling after the recording',
          error,
        )
      })
  }
  // The session recorded, for `start` and `stop` to notice a `discard` that
  // came while they waited.
  const recordingSessionRef = useRef<string | null>(null)
  // The `start` whose live streams may still start. `stop`, `discard` and unmounting clear it:
  // `recordingSessionRef` stays set through `stop`, for the final utterance's callbacks.
  const liveStartRef = useRef<object | null>(null)
  useEffect(
    () => () => {
      liveStartRef.current = null
    },
    [],
  )

  const start = async (session: Session) => {
    const sessionId = session.id
    const attempt = {}
    try {
      updateSession(sessionId, { status: 'recording' })
      recordingSessionRef.current = sessionId
      liveStartRef.current = attempt
      setLiveSessionId(sessionId)
      setMicStarting(true)
      setUtterancesNow([])
      setSpeakers(NO_SPEAKERS)
      const timeOrigin = await startRecording()
      if (recordingSessionRef.current !== sessionId) {
        stopRecording()
        return
      }
      await startLiveStreams(session, timeOrigin, attempt)
    } catch (err) {
      if (liveStartRef.current === attempt) setMicStarting(false)
      // A session deleted while the microphone opened has nothing to reset.
      if (recordingSessionRef.current === sessionId) {
        updateSession(sessionId, { status: 'idle' })
      }
      if (!(err instanceof RecordingCancelledError)) {
        toast.error('Failed to access microphone')
      }
    }
  }

  /**
   * Live transcription and diarization of one microphone capture. The capture holds its audio
   * until both sockets are open, then streams it from its first sample on, so both workers get
   * the same samples and speech while they connected is not lost; diarization slower to open than
   * `DIARIZATION_JOIN_TIMEOUT_MS` joins late instead of holding transcription up.
   * Nothing starts once `attempt` is no longer current: a `stop` or `discard` before the streams
   * exist cannot reach them.
   */
  const startLiveStreams = async (
    session: Session,
    timeOrigin: number,
    attempt: object,
  ) => {
    const sessionId = session.id
    const current = () => liveStartRef.current === attempt
    let capture: LiveCapture
    try {
      capture = await LiveCapture.open()
    } catch {
      logger.warn('Live transcription unavailable; falling back to batch only')
      return
    } finally {
      // The audio is held from here on; without a live capture, the recorder alone has it.
      if (current()) setMicStarting(false)
    }
    try {
      // Stopped while the capture opened: `finally` closes the microphone again.
      if (!current()) return
      const diarizing = startLiveDiarization(session, timeOrigin, capture)
      // The live pass is the source of truth for the transcript text; batch
      // transcription only runs as a fallback when it is unavailable.
      try {
        await liveTranscription.start({
          timeOrigin,
          capture,
          protocol: sttProtocol(sttBackend, {
            language: resolveSttLanguage(
              session.language,
              getServiceSttLanguageOptions(sttService),
            ),
            // Qwen3-ASR's forced aligner times each utterance's words, so a speaker change
            // inside one (a reply with no pause before it) is split where it happens.
            wordTimestamps: diarizationEnabled,
            onTranscript: (t) => {
              if (recordingSessionRef.current !== sessionId) return
              setUtterancesNow([
                ...utterancesRef.current,
                { text: t.text, start: t.start, end: t.end },
              ])
            },
            onWords: ({ start, end, words }) => {
              if (recordingSessionRef.current !== sessionId) return
              // Both carry the utterance's times through the same offset.
              const same = (a: number, b: number) => Math.abs(a - b) < 1e-3
              setUtterancesNow(
                utterancesRef.current.map((u) =>
                  same(u.start, start) && same(u.end, end)
                    ? { ...u, words }
                    : u,
                ),
              )
            },
          }),
        })
      } catch {
        logger.warn(
          'Live transcription unavailable; falling back to batch only',
        )
      }
      await Promise.race([
        diarizing,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), DIARIZATION_JOIN_TIMEOUT_MS)
        }),
      ])
      // Not for a recording stopped or discarded meanwhile: its streams have already let go.
      if (current()) capture.start()
    } finally {
      // The streams hold their own references; the microphone closes with the last.
      capture.release()
    }
  }

  const stop = async () => {
    const sessionId = liveSessionId
    const durationSeconds = Math.floor(recordingElapsedMs / 1000)
    // Mark processing up front, or the dialogue panel briefly falls back to the empty stored
    // transcripts while the final utterance flushes.
    if (sessionId) updateSession(sessionId, { status: 'processing' })
    liveStartRef.current = null
    setMicStarting(false)
    // The recording is diarized as a whole next: a last live pass would only hold that up.
    liveDiarization.dispose()
    // Wait for the final pending utterance, or it is missing from the reused transcript.
    const [, blob] = await Promise.all([
      liveTranscription.stop(),
      stopRecording(),
    ])
    if (!sessionId || recordingSessionRef.current !== sessionId) return
    if (blob.size > 0) {
      processAudio(sessionId, blob, durationSeconds, utterancesRef.current)
    } else {
      updateSession(sessionId, { status: 'idle' })
    }
  }

  /** Ends a deleted session's recording unprocessed, even one still waiting for the microphone. */
  const discard = (sessionId: string) => {
    if (liveSessionId !== sessionId) return
    recordingSessionRef.current = null
    liveStartRef.current = null
    setLiveSessionId(null)
    setMicStarting(false)
    setUtterancesNow([])
    setSpeakers(NO_SPEAKERS)
    liveDiarization.dispose()
    liveTranscription.stop()
    stopRecording()
  }

  return {
    isRecording,
    /** Seconds recorded so far. */
    recordingSeconds: recordingElapsedMs / 1000,
    /** The microphone is still being opened for the live transcript. */
    micStarting,
    liveSessionId,
    liveTranscripts,
    start,
    stop,
    discard,
  }
}
