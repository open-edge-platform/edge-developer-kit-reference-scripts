// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

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
