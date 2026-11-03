// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchWork } from '@/services/common/metrics/work'

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

/**
 * Both engines accept strings; the typed image items are an OEP-only extension of the OpenAI shape
 * (`image_base64` may be a `data:` URL).
 */
export type EmbeddingInput =
  | string
  | { type: 'image_base64'; image_base64: string }
  | { type: 'image_url'; image_url: string }

/** `POST /v1/embeddings` of the instance at `apiBase`, measured for its Live metrics. */
export function useEmbed(apiBase: string | undefined, model: string) {
  return useMutation({
    mutationFn: ({
      input,
      encodingFormat,
    }: {
      input: EmbeddingInput[]
      encodingFormat: string
    }): Promise<EmbeddingResponse> => {
      requireApiBase(apiBase, 'Text Embedding')
      return fetchWork(
        apiBase,
        '/v1/embeddings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            input,
            encoding_format: encodingFormat,
          }),
        },
        () => ({ items: input.length }),
      )
    },
  })
}
