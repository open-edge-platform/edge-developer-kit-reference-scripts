// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

export interface SpeechToTextResponse {
  text: string
  status: boolean
}

export interface TranscriptionOptions {
  file: File
  language?: string
  useDenoise?: boolean
}

export interface TranslationOptions {
  file: File
  language?: string
}

const STT_API = new FetchAPI(`/api/stt`, 'v1')

export const useSpeechToText = () => {
  return useMutation({
    mutationFn: async ({
      file,
      language = 'en',
      useDenoise = false,
    }: TranscriptionOptions): Promise<SpeechToTextResponse> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('language', language)
      formData.append('use_denoise', useDenoise.toString())

      const response = await STT_API.file('audio/transcriptions', formData, {
        headers: {},
      })

      if (!response.ok) {
        throw new Error('Network response was not ok')
      }

      return response.json() as Promise<SpeechToTextResponse>
    },
  })
}

export const useTranslation = () => {
  return useMutation({
    mutationFn: async ({
      file,
      language = 'en',
    }: TranslationOptions): Promise<SpeechToTextResponse> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('language', language)

      const response = await STT_API.file('audio/translations', formData, {
        headers: {},
      })

      if (!response.ok) {
        throw new Error('Network response was not ok')
      }

      return response.json() as Promise<SpeechToTextResponse>
    },
  })
}

// Hook for audio recording functionality
export const useAudioRecording = () => {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach((track) => track.stop())
      }

      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)
    } catch (error) {
      console.error('Error starting recording:', error)
      throw new Error('Could not access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop()
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  const clearRecording = () => {
    setAudioBlob(null)
  }

  return {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    clearRecording,
  }
}
