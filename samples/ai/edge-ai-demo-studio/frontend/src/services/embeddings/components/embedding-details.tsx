// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Fingerprint,
  Loader,
} from 'lucide-react'
import { useState } from 'react'
import { InfoTip } from '@/components/common/info-tip'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { downloadBlob } from '@/lib/browser/download'
import { cn } from '@/lib/utils'
import { StatTile } from '@/services/common/metrics/stat-tile'
import type { ComparisonSubject } from '../hooks/use-embedding-comparison'
import { vectorNorm } from '../lib/embedding-math'
import { describeSubject } from '../lib/similarity-export'

const SHOWN_VALUES = 192

function cellColor(value: number): string {
  const strength = Math.round(Math.min(1, Math.abs(value) * 5) * 100)
  const tone = value >= 0 ? 'var(--primary)' : 'var(--destructive)'
  return `color-mix(in srgb, ${tone} ${strength}%, transparent)`
}

function vectorJson(
  embedding: number[],
  model: string | undefined,
  subject: ComparisonSubject | null,
): string {
  return JSON.stringify(
    {
      model: model ?? null,
      input: subject ? describeSubject(subject) : null,
      dimensions: embedding.length,
      embedding,
    },
    null,
    2,
  )
}

/** Collapsed "Vector details": the raw embedding's stats and a heatmap of its first values. */
export function EmbeddingDetails({
  embedding,
  model,
  pending,
  subject,
}: {
  embedding: number[] | null
  model: string | undefined
  pending: boolean
  /** What was embedded. */
  subject: ComparisonSubject | null
}) {
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopyToClipboard()
  const dims = embedding?.length ?? 0
  const subjectKind = subject?.kind ?? 'text'

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-4">
      <div className="flex w-full items-center gap-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-md">
            <Fingerprint
              aria-hidden
              className="text-muted-foreground h-3.5 w-3.5"
            />
          </div>
          <span className="text-muted-foreground text-sm font-medium">
            Vector details
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'text-muted-foreground ml-auto h-4 w-4 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>
        <InfoTip
          ariaLabel="Info about embeddings"
          contentClassName="max-w-72"
          tooltip="The AI converts your input into a list of numbers called an embedding vector — a mathematical fingerprint that captures meaning. Similar inputs produce similar fingerprints."
        />
      </div>

      <CollapsibleContent className="space-y-4">
        {pending && (
          <div role="status" className="flex h-32 items-center justify-center">
            <Loader aria-hidden className="text-primary h-6 w-6 animate-spin" />
            <span className="sr-only">Computing the embedding…</span>
          </div>
        )}

        {embedding && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="embed-copy-vector"
                onClick={() => void copy(JSON.stringify(embedding))}
              >
                {copied ? (
                  <Check aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <Copy aria-hidden className="h-3.5 w-3.5" />
                )}
                {copied ? 'Copied' : 'Copy vector'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="embed-download-vector"
                onClick={() =>
                  downloadBlob(
                    new Blob([vectorJson(embedding, model, subject)], {
                      type: 'application/json',
                    }),
                    'embedding.json',
                  )
                }
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                Download JSON
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                id="embedding-dimensions"
                label="Dimensions"
                value={String(dims)}
                detail="Values in the vector"
                tip="The number of values in the vector. More dimensions can capture finer shades of meaning."
              />
              <StatTile
                id="embedding-magnitude"
                label="Magnitude"
                value={vectorNorm(embedding).toFixed(2)}
                detail="Length of the vector"
                tip="The length of the vector. Normalized embeddings have a magnitude close to 1."
              />
              {model && (
                <div className="col-span-2 sm:col-span-1">
                  <StatTile
                    id="embedding-model"
                    label="Model"
                    value={model}
                    detail="Answered the request"
                    tip="The model the service reports for this embedding."
                  />
                </div>
              )}
            </div>

            <figure className="border-border bg-muted/10 rounded-xl border p-4">
              <figcaption className="text-muted-foreground mb-3 text-xs">
                Each cell is one number in the AI&apos;s
                &ldquo;fingerprint&rdquo; for your {subjectKind}. Similar inputs
                produce similar color patterns.
              </figcaption>
              <div aria-hidden="true" className="grid grid-cols-16 gap-[2px]">
                {/* One cell per position of the vector: positions are fixed. */}
                {embedding.slice(0, SHOWN_VALUES).map((val, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-[2px]"
                    style={{ backgroundColor: cellColor(val) }}
                    title={`Value ${i + 1} of ${dims}: ${val.toFixed(4)}`}
                  />
                ))}
              </div>
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span>
                  Showing {Math.min(SHOWN_VALUES, dims)} of {dims} values
                </span>
                <span>
                  <span aria-hidden="true" className="text-primary">
                    ■
                  </span>{' '}
                  Positive
                  <span aria-hidden="true" className="text-destructive ml-1.5">
                    ■
                  </span>{' '}
                  Negative
                </span>
              </div>
            </figure>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
