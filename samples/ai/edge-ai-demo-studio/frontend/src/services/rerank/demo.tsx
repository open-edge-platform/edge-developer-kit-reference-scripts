// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { Loader, Play, RotateCcw } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { getServiceModelName } from '@/services/common/get-service-model'
import type { Service } from '@/services/types'
import { CandidateDocuments } from './components/candidate-documents'
import { RerankResults } from './components/rerank-results'
import { useRerank } from './hooks'
import { useRerankParams } from './hooks/use-params'
import {
  newDocument,
  type SubmittedDocuments,
  submittedDocuments,
} from './lib/documents'

const DEFAULT_QUERY = 'What is OpenVINO?'

const DEFAULT_DOCUMENTS = [
  'Edge AI processes data locally on devices, reducing latency and improving privacy.',
  'Cloud computing relies on remote data centers to store and process information.',
  'OpenVINO is an open-source toolkit that optimizes AI inference on Intel hardware.',
  'A recipe for making chocolate chip cookies from scratch.',
  'Intel Xeon processors feature AMX instructions for accelerated AI workloads.',
]

export function RerankerDemo({ service }: { service: Service }) {
  const [query, setQuery] = useSessionState(
    demoStateKey(service, 'rerank:query'),
    DEFAULT_QUERY,
  )
  const [documents, setDocuments] = useSessionState(
    demoStateKey(service, 'rerank:documents'),
    () => DEFAULT_DOCUMENTS.map((text) => newDocument(text)),
  )
  // The documents the shown ranking was asked for: the boxes may change.
  const [submitted, setSubmitted] = useState<SubmittedDocuments | null>(null)

  const model = getServiceModelName(service, true) ?? ''

  const rerankMutation = useRerank(service.apiBase, model)
  const { values: rerankValues, params } = useRerankParams({
    sessionKey: demoStateKey(service, 'rerank:params'),
  })

  const toSubmit = submittedDocuments(documents)

  const handleRerank = () => {
    setSubmitted(toSubmit)
    rerankMutation.mutate({
      query,
      documents: toSubmit.texts,
      topN: rerankValues.topN,
    })
  }

  const handleClear = () => {
    rerankMutation.reset()
    setSubmitted(null)
  }

  const hasResults = (rerankMutation.data?.results.length ?? 0) > 0

  return (
    <DemoLayout sidebar={<DemoParameterSidebar params={params} />}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="rerank-query"
              className="text-foreground text-sm font-medium"
            >
              Query
            </Label>
            <Textarea
              id="rerank-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter the search query..."
              rows={2}
              className="bg-muted/30 resize-none"
            />
          </div>

          <CandidateDocuments
            documents={documents}
            onChange={setDocuments}
            disabled={rerankMutation.isPending}
          />

          <div className="flex gap-2">
            <Button
              onClick={handleRerank}
              disabled={
                rerankMutation.isPending ||
                !query.trim() ||
                toSubmit.texts.length === 0
              }
              className="flex-1 gap-2"
            >
              {rerankMutation.isPending ? (
                <>
                  <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Reranking...
                </>
              ) : (
                <>
                  <Play aria-hidden="true" className="h-4 w-4" />
                  Rerank
                </>
              )}
            </Button>
            {hasResults && (
              <Button variant="outline" className="gap-2" onClick={handleClear}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Clear results
              </Button>
            )}
          </div>

          {rerankMutation.isError && (
            <InlineNotice tone="destructive" size="sm">
              {rerankMutation.error.message}
            </InlineNotice>
          )}
        </div>

        <RerankResults
          response={rerankMutation.data}
          submitted={submitted}
          pending={rerankMutation.isPending}
        />
      </div>
    </DemoLayout>
  )
}
