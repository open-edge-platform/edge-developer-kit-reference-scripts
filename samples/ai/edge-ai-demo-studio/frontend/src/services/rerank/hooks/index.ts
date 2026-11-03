// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchWork } from '@/services/common/metrics/work'

interface RerankResult {
  index: number
  relevance_score: number
  document?: { text: string }
}

export interface RerankResponse {
  results: RerankResult[]
}

export function useRerank(apiBase: string | undefined, model: string) {
  return useMutation({
    mutationFn: ({
      query,
      documents,
      topN,
    }: {
      query: string
      documents: string[]
      topN: number
    }): Promise<RerankResponse> => {
      requireApiBase(apiBase, 'Reranker')
      // Every document is scored, however few `top_n` returns.
      return fetchWork(
        apiBase,
        '/v1/rerank',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            query,
            documents,
            top_n: topN,
            return_documents: true,
          }),
        },
        () => ({ items: documents.length }),
      )
    },
  })
}
