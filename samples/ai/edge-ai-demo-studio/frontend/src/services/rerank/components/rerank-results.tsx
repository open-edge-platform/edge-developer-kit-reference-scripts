// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowDown, ArrowUp, ListOrdered, Loader, Minus } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { RerankResponse } from '../hooks'
import { rankMovement, type SubmittedDocuments } from '../lib/documents'

/** The bar's colour by score; the number and rank carry the meaning. */
function scoreBar(score: number): string {
  if (score > 0.7) return 'bg-primary'
  if (score > 0.4) return 'bg-info'
  return 'bg-muted-foreground/30'
}

function MovementIcon({
  original,
  ranked,
}: {
  original: number
  ranked: number
}) {
  const Icon =
    original > ranked ? ArrowUp : original < ranked ? ArrowDown : Minus
  return <Icon aria-hidden="true" className="h-3 w-3" />
}

/** The documents in their new order, each with its original box number and how far it moved. */
export function RerankResults({
  response,
  submitted,
  pending,
}: {
  response: RerankResponse | undefined
  /** What the shown ranking was asked for. */
  submitted: SubmittedDocuments | null
  pending: boolean
}) {
  const results = response?.results ?? []
  const total = submitted?.texts.length ?? 0

  return (
    <section aria-labelledby="rerank-results-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="rerank-results-heading"
          className="text-foreground text-sm font-medium"
        >
          Ranked results
        </h3>
        {results.length > 0 && (
          <Badge variant="secondary" className="font-mono text-xs">
            {results.length < total
              ? `Top ${results.length} of ${total}`
              : `${results.length} of ${total}`}
          </Badge>
        )}
      </div>
      <p
        className="text-muted-foreground text-xs"
        data-testid="rerank-score-help"
      >
        Scores are relative: they say how relevant each document is to this
        query compared with the others in this list. Use them to order these
        documents, not as a probability or to compare across queries or models.
      </p>

      <div className="border-border bg-muted/20 min-h-[200px] rounded-xl border p-4">
        {results.length === 0 && !pending && (
          <EmptyState
            icon={ListOrdered}
            size="sm"
            description="Ranked results will appear here, with each document's original and new rank."
            className="h-[200px] py-0"
          />
        )}

        {pending && (
          <div
            role="status"
            className="flex h-[200px] items-center justify-center gap-2"
          >
            <Loader
              aria-hidden="true"
              className="text-primary h-6 w-6 animate-spin"
            />
            <span className="text-muted-foreground text-sm">Reranking…</span>
          </div>
        )}

        {results.length > 0 && !pending && (
          <ol className="space-y-3" data-testid="rerank-results">
            {results.map((result, position) => {
              const ranked = position + 1
              const original =
                submitted?.numbers[result.index] ?? result.index + 1
              const text =
                result.document?.text ?? submitted?.texts[result.index] ?? ''
              return (
                <li
                  data-testid={`rerank-result-${result.index}`}
                  key={`r-${result.index}`}
                  className="border-border bg-background space-y-2 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge
                        variant="default"
                        className="font-mono text-xs"
                        data-testid="rerank-new-rank"
                      >
                        New #{ranked}
                      </Badge>
                      <span
                        className="text-muted-foreground"
                        data-testid="rerank-original-rank"
                      >
                        Original #{original}
                      </span>
                      <span
                        className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium"
                        data-testid="rerank-movement"
                      >
                        <MovementIcon original={original} ranked={ranked} />
                        {rankMovement(original, ranked)}
                      </span>
                    </div>
                    <span className="text-foreground font-mono text-sm font-semibold">
                      <span className="sr-only">Score </span>
                      {result.relevance_score.toFixed(4)}
                    </span>
                  </div>
                  {text && (
                    <p className="text-muted-foreground text-sm leading-relaxed break-words">
                      {text}
                    </p>
                  )}
                  <Progress
                    value={
                      Math.max(0, Math.min(1, result.relevance_score)) * 100
                    }
                    aria-label={`Relevance of document ${original}`}
                    className="h-1.5"
                    indicatorClassName={scoreBar(result.relevance_score)}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
