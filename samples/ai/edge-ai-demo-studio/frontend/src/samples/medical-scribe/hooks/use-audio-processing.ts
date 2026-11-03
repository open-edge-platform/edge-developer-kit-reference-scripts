// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useServiceApiBase } from '@/context/service-status-context'
import { logger } from '@/lib/logger'
import {
  DIARIZATION_DEFAULTS,
  DiarizationCancelledError,
  useDiarize,
} from '@/services/diarization/hooks'
import { useTranscribe } from '@/services/speech-to-text/hooks/use-transcribe'
import { timestampNow } from '../lib/timestamps'
import { alignTranscriptWithSegments } from '../lib/transcript-alignment'
import type {
  DoctorProfile,
  Session,
  SessionUpdate,
  TranscriptEntry,
} from '../lib/types'

/** The length of a recording in seconds, or `null` when it cannot be read. */
async function readAudioDuration(audio: Blob): Promise<number | null> {
  const url = URL.createObjectURL(audio)
  try {
    const audioEl = new Audio(url)
    await new Promise<void>((resolve) => {
      audioEl.onloadedmetadata = () => resolve()
      audioEl.onerror = () => resolve()
    })
    return Number.isFinite(audioEl.duration) ? audioEl.duration : null
  } catch {
    logger.warn('Could not read audio duration')
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Turns a recording into a session's speaker-labelled transcript (transcription or the live pass's
 * utterances, plus diarization when enabled). `cancel` drops a session's run without saving it.
 */
export function useAudioProcessing({
  sessions,
  profiles,
  updateSession,
  diarizationEnabled,
}: {
  sessions: Session[]
  profiles: DoctorProfile[]
  updateSession: (id: string, updates: SessionUpdate) => void
  diarizationEnabled: boolean
}) {
  const transcribe = useTranscribe(useServiceApiBase('speech-to-text'))
  // Leaving the page cancels the diarization jobs still running (useDiarize).
  const diarize = useDiarize(useServiceApiBase('diarization'))
  // The processing in flight, by session.
  const processingRef = useRef(new Map<string, AbortController>())
  // The length of the audio being processed, by session (shown meanwhile).
  const [audioDurations, setAudioDurations] = useState<
    Record<string, number | null>
  >({})
  const setDuration = (sessionId: string, value: number | null) =>
    setAudioDurations((prev) => ({ ...prev, [sessionId]: value }))

  const processAudio = async (
    sessionId: string,
    audio: Blob,
    knownDuration?: number,
    liveSegments?: TranscriptEntry[],
  ) => {
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    const controller = new AbortController()
    processingRef.current.set(sessionId, controller)

    setDuration(sessionId, null)
    updateSession(sessionId, { status: 'processing' })
    setDuration(sessionId, knownDuration ?? (await readAudioDuration(audio)))

    try {
      const doctorProfile = profiles.find(
        (p) => p.id === session.doctorProfileId,
      )

      // Reuse the live pass's utterances rather than transcribing the recording a second time.
      const reusable = (liveSegments ?? []).filter((s) => s.text.trim())
      const liveResult =
        reusable.length > 0
          ? {
              text: reusable.map((s) => s.text.trim()).join(' '),
              segments: reusable.map((s) => ({
                start: s.start,
                end: s.end,
                text: s.text.trim(),
              })),
            }
          : null
      if (liveResult) {
        logger.info(
          `Reusing ${reusable.length} live utterance(s); skipping batch transcription`,
        )
      }

      const [transcriptResult, diarizeResult] = await Promise.all([
        liveResult ??
          transcribe.mutateAsync({
            file: audio,
            language: session.language,
            returnTimestamps: true,
          }),
        diarizationEnabled
          ? diarize.mutateAsync({
              file: audio,
              signal: controller.signal,
              speakerMatchThreshold: DIARIZATION_DEFAULTS.speakerMatchThreshold,
              ...(doctorProfile?.embedding
                ? {
                    referenceEmbedding: doctorProfile.embedding,
                    referenceLabel: 'Doctor',
                    otherLabel: 'Patient',
                  }
                : { numSpeakers: 2 }),
            })
          : Promise.resolve(null),
      ])
      // The session was deleted meanwhile: nothing to save the result to.
      if (controller.signal.aborted) return

      const transcripts = diarizeResult
        ? alignTranscriptWithSegments(
            transcriptResult.text,
            diarizeResult.segments,
            transcriptResult.segments,
          )
        : liveResult
          ? // No diarization: keep the live pass's per-utterance split, not one block.
            liveResult.segments.map((s) => ({ speaker: 'Speaker', ...s }))
          : [
              {
                speaker: 'Speaker',
                text: transcriptResult.text,
                start: transcriptResult.segments?.[0]?.start ?? 0,
                end: transcriptResult.segments?.at(-1)?.end ?? 0,
              },
            ]

      updateSession(sessionId, {
        status: 'completed',
        transcripts,
        dialogueCreatedAt: timestampNow(),
      })
      toast.success('Audio processed successfully')
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof DiarizationCancelledError) {
        // Cancelled without the session being deleted: the page was left
        // while it ran. Not a failure worth a toast.
        updateSession(sessionId, {
          status: 'error',
          errorMessage:
            'Processing was interrupted before it finished. Please record or upload again.',
        })
        return
      }
      updateSession(sessionId, {
        status: 'error',
        errorMessage: 'Failed to process audio',
      })
      toast.error('Failed to process audio')
    } finally {
      setDuration(sessionId, null)
      if (processingRef.current.get(sessionId) === controller) {
        processingRef.current.delete(sessionId)
      }
    }
  }

  return {
    processAudio,
    cancel: (sessionId: string) =>
      processingRef.current.get(sessionId)?.abort(),
    audioDurations,
  }
}
