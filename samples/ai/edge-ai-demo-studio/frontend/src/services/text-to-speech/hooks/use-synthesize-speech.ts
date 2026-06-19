// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export function useSynthesizeSpeech() {
  return useMutation({
    mutationFn: async (params: {
      input: string
      voice: string
      speed: number
      responseFormat: string
      volumeMultiplier?: number
    }): Promise<Blob> => {
      const res = await fetch('/api/text-to-speech/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: params.input,
          voice: params.voice,
          speed: params.speed,
          response_format: params.responseFormat,
          stream: false,
          ...(params.volumeMultiplier !== undefined && {
            volume_multiplier: params.volumeMultiplier,
          }),
        }),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(detail || `Request failed with status ${res.status}`)
      }
      return res.blob()
    },
  })
}
