// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { useMutation, useQuery } from '@tanstack/react-query'

const TTS_API = new FetchAPI(`/api/tts`, 'v1')

export const useTextToSpeech = () => {
  return useMutation({
    mutationFn: async ({
      input,
      model,
      voice,
      responseFormat,
      speed,
    }: {
      input: string
      model?: string
      voice?: string
      langCode?: string
      responseFormat?: string
      speed?: number
    }) => {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input,
          responseFormat,
          speed,
          stream: false,
        }),
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response
    },
  })
}

export const useGetVoices = () => {
  return useQuery({
    queryKey: ['tts-voices'],
    queryFn: async () => {
      const response = await TTS_API.get('audio/voices')
      return response
    },
  })
}
