// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowUpDown, Loader2, Play, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import type { Service } from '@/services/types'
import { getServiceModelName } from '@/services/common/get-service-model'
import { useRerank } from './hooks'
import { useRerankParams } from './hooks/use-params'

const DEFAULT_QUERY = 'What is OpenVINO?'

const DEFAULT_DOCUMENTS = [
  'Edge AI processes data locally on devices, reducing latency and improving privacy.',
  'Cloud computing relies on remote data centers to store and process information.',
  'OpenVINO is an open-source toolkit that optimizes AI inference on Intel hardware.',
  'A recipe for making chocolate chip cookies from scratch.',
  'Intel Xeon processors feature AMX instructions for accelerated AI workloads.',
]

export function RerankerDemo({ service }: { service: Service }) {
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [documents, setDocuments] = useState(DEFAULT_DOCUMENTS.join('\n\n'))

  const model = getServiceModelName(service, true) ?? ''

  const rerankMutation = useRerank(service.id, model)
  const { values: rerankValues, params } = useRerankParams()

  const docs = documents
    .split('\n\n')
    .map((d) => d.trim())
    .filter(Boolean)

  const handleRerank = () => {
    rerankMutation.mutate({ query, documents: docs, topN: rerankValues.topN })
  }

  const handleClear = () => {
    rerankMutation.reset()
  }

  const results = rerankMutation.data?.results ?? []

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Query</p>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter the search query..."
              rows={2}
              className="bg-muted/30 resize-none"
            />

            <p className="text-foreground text-sm font-medium">
              Candidate Documents
            </p>
            <Textarea
              value={documents}
              onChange={(e) => setDocuments(e.target.value)}
              placeholder="Enter documents separated by blank lines..."
              rows={8}
              className="bg-muted/30 resize-none text-sm"
            />
            <div className="text-muted-foreground text-xs">
              {docs.length} documents
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleRerank}
                disabled={
                  rerankMutation.isPending || !query.trim() || docs.length === 0
                }
                className="bg-primary hover:bg-primary-light flex-1 gap-2 text-white"
              >
                {rerankMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reranking...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Rerank
                  </>
                )}
              </Button>
              {results.length > 0 && (
                <Button variant="outline" size="icon" onClick={handleClear}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>

            {rerankMutation.isError && (
              <p className="text-destructive text-xs">
                {rerankMutation.error.message}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">
                Ranked Results
              </p>
              {results.length > 0 && (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {results.length} results
                </Badge>
              )}
            </div>

            <div className="border-border bg-muted/20 min-h-[300px] rounded-xl border p-4">
              {results.length === 0 && !rerankMutation.isPending && (
                <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">
                  Ranked results will appear here...
                </div>
              )}

              {rerankMutation.isPending && (
                <div className="flex h-[300px] items-center justify-center">
                  <Loader2 className="text-primary h-8 w-8 animate-spin" />
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-3" data-testid="rerank-results">
                  {results.map((result, rank) => (
                    <div
                      data-testid={`rerank-result-${result.index}`}
                      key={`r-${result.index}`}
                      className="border-border bg-background space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            #{rank + 1}
                          </Badge>
                          <ArrowUpDown className="text-muted-foreground h-3 w-3" />
                          <span className="text-muted-foreground text-xs">
                            Doc {result.index + 1}
                          </span>
                        </div>
                        <span className="text-foreground font-mono text-sm font-semibold">
                          {result.relevance_score.toFixed(4)}
                        </span>
                      </div>
                      {result.document?.text && (
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {result.document.text}
                        </p>
                      )}
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            result.relevance_score > 0.7
                              ? 'bg-primary'
                              : result.relevance_score > 0.4
                                ? 'bg-secondary'
                                : 'bg-muted-foreground/30',
                          )}
                          style={{
                            width: `${result.relevance_score * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={params} />
      </div>
    </div>
  )
}
