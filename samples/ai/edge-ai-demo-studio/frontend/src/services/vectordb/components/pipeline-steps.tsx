// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check } from 'lucide-react'
import { plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'

interface PipelineStepsProps {
  /** The Embeddings instance the worker embeds with (see "Embedding and reranking"). */
  embeddingsName?: string
  documentCount: number
  /** Documents uploaded but not embedded yet. */
  pendingCount: number
  chunkCount: number
  isEmbedding: boolean
  /** A search ran on this knowledge base during this visit. */
  searched: boolean
}

interface StepView {
  title: string
  status: string
  done: boolean
}

/** Upload, embed, search: where the knowledge base stands, so the next step is obvious. */
export function PipelineSteps({
  embeddingsName,
  documentCount,
  pendingCount,
  chunkCount,
  isEmbedding,
  searched,
}: PipelineStepsProps) {
  const steps: StepView[] = [
    {
      title: 'Upload documents',
      done: documentCount > 0,
      status:
        documentCount > 0
          ? `${plural(documentCount, 'document')} uploaded`
          : 'PDF, TXT, DOCX and more, or add text directly',
    },
    {
      title: 'Generate embeddings',
      done: chunkCount > 0 && pendingCount === 0 && !isEmbedding,
      status: [
        isEmbedding
          ? 'Embedding…'
          : pendingCount > 0
            ? `${plural(pendingCount, 'document')} waiting`
            : chunkCount > 0
              ? `${plural(chunkCount, 'chunk')} stored`
              : 'Nothing to embed yet',
        embeddingsName ? `with ${embeddingsName}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      title: 'Search',
      done: searched,
      status: searched
        ? 'Searched'
        : chunkCount > 0
          ? 'Ready: ask a question'
          : 'Available once chunks are stored',
    },
  ]

  return (
    <ol
      aria-label="Knowledge base steps"
      className="grid gap-2 sm:grid-cols-3"
      data-testid="vectordb-steps"
    >
      {steps.map((step, i) => (
        <li
          key={step.title}
          className={cn(
            'flex items-start gap-2.5 rounded-lg border p-3',
            step.done ? 'border-primary/40 bg-primary/5' : 'border-border',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              step.done
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">
              <span className="sr-only">
                Step {i + 1}
                {step.done ? ', done' : ''}:{' '}
              </span>
              {step.title}
            </p>
            <p className="text-muted-foreground text-xs">{step.status}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
