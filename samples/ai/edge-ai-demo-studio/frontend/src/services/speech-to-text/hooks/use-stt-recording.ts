// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { useServiceApiBase } from '@/context/service-status-context'
import { useTranscribe } from './use-transcribe'

interface UseSttRecordingOptions {
  onTranscription: (text: string) => void
}

/** Chat voice input: records until stopped, then transcribes (English) to `onTranscription`. */
export function useSttRecording({ onTranscription }: UseSttRecordingOptions) {
  const apiBase = useServiceApiBase('speech-to-text')
  const { mutate: transcribe, isPending: isTranscribePending } =
    useTranscribe(apiBase)

  const {
    isRecording,
    error: micError,
    start,
    stop,
  } = useMediaRecorder({
    onStop: (blob) => {
      if (blob.size === 0) return
      transcribe(
        { file: blob, language: 'en', useDenoise: false },
        {
          onSuccess: (data) => {
            if (data.text) {
              onTranscription(data.text)
            }
          },
        },
      )
    },
  })

  const startRecording = async () => {
    try {
      await start()
    } catch {
      // `micError` already reflects the failure via useMediaRecorder.
    }
  }

  const stopRecording = () => {
    stop()
  }

  return {
    isRecording,
    isPending: isTranscribePending,
    micError,
    startRecording,
    stopRecording,
  }
}
