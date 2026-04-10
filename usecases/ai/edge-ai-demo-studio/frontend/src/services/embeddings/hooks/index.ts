// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export {
  useEmbeddingsParams,
  EMBEDDINGS_DEFAULTS,
  ENCODING_FORMAT_OPTIONS,
} from './use-params'
export type { EmbeddingsParamValues } from './use-params'

interface EmbeddingItem {
  object: string
  embedding: number[] | string
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: EmbeddingItem[]
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

export function useEmbed(serviceId: string, model: string) {
  return useMutation({
    mutationFn: async ({
      input,
      encodingFormat,
    }: {
      input: string[]
      encodingFormat: string
    }): Promise<EmbeddingResponse> => {
      const res = await fetch(`/api/${serviceId}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input,
          encoding_format: encodingFormat,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || res.statusText)
      }
      return res.json()
    },
  })
}
