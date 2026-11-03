// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useGetService } from '@/context/service-status-context'
import { useElapsedMs } from '@/hooks/use-elapsed-ms'
import { RecordingCancelledError } from '@/hooks/use-media-recorder'
import { logger } from '@/lib/logger'
import { getRunningSttBackend } from '@/services/speech-to-text/config'
import { useLiveStream } from '@/services/speech-to-text/hooks/use-live-stream'
import type { Session, SessionUpdate, TranscriptEntry } from '../lib/types'
import { useRecording } from './use-recording'

/**
 * Records a consultation with live transcription, reused as the transcript when processed. The
 * recording belongs to the session it started in, even if another one is selected meanwhile.
 */
export function useLiveRecording({
  updateSession,
  processAudio,
}: {
  updateSession: (id: string, updates: SessionUpdate) => void
  processAudio: (
    sessionId: string,
    audio: Blob,
    knownDuration?: number,
    liveSegments?: TranscriptEntry[],
  ) => Promise<void>
}) {
  const { isRecording, startRecording, stopRecording } = useRecording()
  // The type's primary instance: the running one, else the first.
  const sttService = useGetService('speech-to-text')
  const liveTranscription = useLiveStream(sttService)
  // The live WebSocket follows the running worker's backend (/v1/realtime on OEP,
  // /v1/audio/stream on OVMS), not a backend saved for the next start.
  const sttBackend = getRunningSttBackend(sttService)
  const recordingElapsedMs = useElapsedMs(isRecording)

  // The session the live transcript belongs to (kept after the recording
  // stops, while it is processed).
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [liveTranscripts, setLiveTranscripts] = useState<TranscriptEntry[]>([])
  // The same utterances for `stop`, which runs in the click that ends the
  // recording, before a re-render could hand it the latest state.
  const liveTranscriptsRef = useRef<TranscriptEntry[]>([])
  // The session recorded, for `start` and `stop` to notice a `discard` that
  // came while they waited.
  const recordingSessionRef = useRef<string | null>(null)

  const start = async (session: Session) => {
    const sessionId = session.id
    try {
      updateSession(sessionId, { status: 'recording' })
      recordingSessionRef.current = sessionId
      setLiveSessionId(sessionId)
      setLiveTranscripts([])
      liveTranscriptsRef.current = []
      const timeOrigin = await startRecording()
      if (recordingSessionRef.current !== sessionId) {
        stopRecording()
        return
      }
      // The live pass is the source of truth for the transcript text; batch
      // transcription only runs as a fallback when it is unavailable.
      try {
        await liveTranscription.start({
          language: session.language,
          backend: sttBackend,
          timeOrigin,
          onTranscript: (t) => {
            const entry: TranscriptEntry = {
              speaker: '',
              text: t.text,
              start: t.start,
              end: t.end,
            }
            liveTranscriptsRef.current = [...liveTranscriptsRef.current, entry]
            setLiveTranscripts(liveTranscriptsRef.current)
          },
        })
      } catch {
        logger.warn(
          'Live transcription unavailable; falling back to batch only',
        )
      }
    } catch (err) {
      // A session deleted while the microphone opened has nothing to reset.
      if (recordingSessionRef.current === sessionId) {
        updateSession(sessionId, { status: 'idle' })
      }
      if (!(err instanceof RecordingCancelledError)) {
        toast.error('Failed to access microphone')
      }
    }
  }

  const stop = async () => {
    const sessionId = liveSessionId
    const durationSeconds = Math.floor(recordingElapsedMs / 1000)
    // Mark processing up front, or the dialogue panel briefly falls back to the empty stored
    // transcripts while the final utterance flushes.
    if (sessionId) updateSession(sessionId, { status: 'processing' })
    // Wait for the final pending utterance, or it is missing from the reused transcript.
    const [, blob] = await Promise.all([
      liveTranscription.stop(),
      stopRecording(),
    ])
    if (!sessionId || recordingSessionRef.current !== sessionId) return
    if (blob.size > 0) {
      processAudio(sessionId, blob, durationSeconds, liveTranscriptsRef.current)
    } else {
      updateSession(sessionId, { status: 'idle' })
    }
  }

  /** Ends a deleted session's recording unprocessed, even one still waiting for the microphone. */
  const discard = (sessionId: string) => {
    if (liveSessionId !== sessionId) return
    recordingSessionRef.current = null
    setLiveSessionId(null)
    setLiveTranscripts([])
    liveTranscriptsRef.current = []
    liveTranscription.stop()
    stopRecording()
  }

  return {
    isRecording,
    /** Seconds recorded so far. */
    recordingSeconds: recordingElapsedMs / 1000,
    liveSessionId,
    liveTranscripts,
    start,
    stop,
    discard,
  }
}
