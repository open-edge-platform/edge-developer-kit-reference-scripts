// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMicErrorMessage } from '@/lib/media-utils'
import { useTranscribe } from './use-transcribe'

interface UseSttRecordingOptions {
  onTranscription: (text: string) => void
}

export function useSttRecording({ onTranscription }: UseSttRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const { mutate: transcribe, isPending: isTranscribePending } = useTranscribe()

  const startRecording = useCallback(async () => {
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
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      setMicError(getMicErrorMessage(error))
    }
  }, [transcribe, onTranscription])

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    mediaRecorderRef.current?.stop()
  }, [])

  useEffect(() => {
    return () => {
      const tracks = mediaRecorderRef.current?.stream?.getTracks()
      if (tracks) for (const t of tracks) t.stop()
    }
  }, [])

  return {
    isRecording,
    isPending: isTranscribePending,
    micError,
    startRecording,
    stopRecording,
  }
}
