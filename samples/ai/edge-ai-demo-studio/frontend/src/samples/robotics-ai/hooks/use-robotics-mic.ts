// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useServiceApiBase } from '@/context/service-status-context'
import type { VoiceInputControls } from '@/context/voice-input-context'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { getErrorMessage } from '@/lib/errors'
import { useTranscribe } from '@/services/speech-to-text/hooks/use-transcribe'
import type { RobotLanguage } from '../lib/languages'

/**
 * Transcription uploads, one at a time. A live update is dropped while another upload runs (it
 * would be stale by its turn); the final recording queues behind it. After a failure nothing more
 * is sent until the next recording.
 */
class TranscriptionUploads {
  private tail: Promise<void> = Promise.resolve()
  private inFlight = 0
  private failed = false

  /** A new recording starts. */
  reset(): void {
    this.failed = false
  }

  /** An upload failed: the rest of this recording is not sent. */
  fail(): void {
    this.failed = true
  }

  /** A live update: dropped while another upload is running. */
  live(send: () => Promise<void>): void {
    if (this.inFlight === 0 && !this.failed) this.enqueue(send)
  }

  /** The finished recording: sent after whatever runs now. */
  final(send: () => Promise<void>): void {
    if (!this.failed) this.enqueue(send)
  }

  private enqueue(send: () => Promise<void>): void {
    this.inFlight += 1
    this.tail = this.tail.then(send).finally(() => {
      this.inFlight -= 1
    })
  }
}

/**
 * The chat's microphone: records in one-second chunks and transcribes the recording so far as it
 * grows, so the draft follows what is said. A failed transcription stops the recording.
 */
export function useRoboticsMic({
  language,
  onTranscribed,
}: {
  language: RobotLanguage
  /** Called with the transcript so far, replacing the draft. */
  onTranscribed: (text: string) => void
}): VoiceInputControls {
  const sttApiBase = useServiceApiBase('speech-to-text')
  const { mutateAsync: transcribe, isPending: isTranscribing } =
    useTranscribe(sttApiBase)
  const [uploads] = useState(() => new TranscriptionUploads())
  const [uploadError, setUploadError] = useState<string | null>(null)

  const recorder = useMediaRecorder({
    mimeType: 'audio/webm;codecs=opus',
    timesliceMs: 1000,
    onChunk: (_chunk, recorded) =>
      uploads.live(() =>
        upload(new Blob([...recorded], { type: 'audio/webm' }), true),
      ),
    onStop: (blob) => {
      if (blob.size > 0) uploads.final(() => upload(blob, false))
    },
  })

  async function upload(blob: Blob, live: boolean): Promise<void> {
    try {
      const data = await transcribe({ file: blob, language, useDenoise: false })
      onTranscribed(typeof data?.text === 'string' ? data.text : '')
    } catch (error) {
      uploads.fail()
      setUploadError(`Transcription failed: ${getErrorMessage(error)}`)
      // The speech service is unreachable: stop listening.
      if (live) recorder.stop()
    }
  }

  return {
    isRecording: recorder.isRecording,
    // A transcript still on its way after the recording stopped.
    isPending: isTranscribing && !recorder.isRecording,
    micError: recorder.error ?? uploadError,
    startRecording: () => {
      uploads.reset()
      setUploadError(null)
      recorder.start().catch(() => {
        // `recorder.error` says why (no microphone, permission denied…).
      })
    },
    stopRecording: () => void recorder.stop(),
  }
}
