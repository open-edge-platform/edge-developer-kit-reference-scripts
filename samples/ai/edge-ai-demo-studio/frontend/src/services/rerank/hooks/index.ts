// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'

export type { RerankParamValues } from './use-params'

interface RerankResult {
  index: number
  relevance_score: number
  document?: { text: string }
}

export interface RerankResponse {
  results: RerankResult[]
}

export function useRerank(serviceId: string, model: string) {
  return useMutation({
    mutationFn: async ({
      query,
      documents,
      topN,
    }: {
      query: string
      documents: string[]
      topN: number
    }): Promise<RerankResponse> => {
      const res = await fetch(`/api/${serviceId}/v1/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          query,
          documents,
          top_n: topN,
          return_documents: true,
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
