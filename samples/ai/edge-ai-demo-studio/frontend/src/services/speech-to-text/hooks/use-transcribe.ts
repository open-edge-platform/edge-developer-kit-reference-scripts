// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export interface TranscribeSegment {
  start: number
  end: number
  text: string
}

export function useTranscribe() {
  return useMutation({
    mutationFn: async ({
      file,
      language,
      useDenoise,
      returnTimestamps,
    }: {
      file: Blob
      language: string
      useDenoise: boolean
      returnTimestamps?: boolean
    }) => {
      const formData = new FormData()
      const filename = file instanceof File ? file.name : 'recording.webm'
      formData.append('file', file, filename)
      formData.append('language', language)
      formData.append('use_denoise', String(useDenoise))
      if (returnTimestamps) {
        formData.append('return_timestamps', 'true')
      }

      const res = await fetch('/api/speech-to-text/v1/audio/transcriptions', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Transcription failed')
      }
      return res.json() as Promise<{
        text: string
        status: boolean
        segments?: TranscribeSegment[]
      }>
    },
  })
}
