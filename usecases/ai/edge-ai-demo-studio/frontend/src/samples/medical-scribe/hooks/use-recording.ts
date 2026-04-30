// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useRef, useState } from 'react'

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    })
    chunksRef.current = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    mediaRecorderRef.current = mediaRecorder
    mediaRecorder.start(1000)
    setIsRecording(true)
    setAudioBlob(null)
  }, [])

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise<Blob>((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state !== 'recording') {
        setIsRecording(false)
        resolve(new Blob())
        return
      }

      recorder.addEventListener(
        'stop',
        () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          setAudioBlob(blob)
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          resolve(blob)
        },
        { once: true },
      )

      recorder.stop()
      setIsRecording(false)
    })
  }, [])

  const clearAudio = useCallback(() => {
    setAudioBlob(null)
  }, [])

  return { isRecording, audioBlob, startRecording, stopRecording, clearAudio }
}
