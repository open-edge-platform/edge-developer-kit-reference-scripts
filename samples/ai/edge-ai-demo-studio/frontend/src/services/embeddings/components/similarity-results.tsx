// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BarChart3, Check, Copy, Download, Loader } from 'lucide-react'
import { InfoTip } from '@/components/common/info-tip'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { downloadBlob } from '@/lib/browser/download'
import type {
  ComparisonSubject,
  SimilarityResult,
} from '../hooks/use-embedding-comparison'
import { type SimilarityLevel, similarityLevel } from '../lib/embedding-math'
import {
  describeSubject,
  rankBySimilarity,
  similarityCsv,
  similarityText,
} from '../lib/similarity-export'

const LEVEL_STYLE: Record<
  SimilarityLevel,
  { bar: string; badge: 'default' | 'secondary' | 'outline' }
> = {
  High: { bar: 'bg-primary', badge: 'default' },
  Moderate: { bar: 'bg-info', badge: 'secondary' },
  Low: { bar: 'bg-muted-foreground/40', badge: 'outline' },
}

/** Each reference text's similarity to the subject, best first. */
export function SimilarityResults({
  results,
  subject,
  pending,
}: {
  results: SimilarityResult[]
  /** What the references were compared with. */
  subject: ComparisonSubject | null
  pending: boolean
}) {
  const ranked = rankBySimilarity(results)
  const { copied, copy } = useCopyToClipboard()
  const done = ranked.length > 0 && !pending

  return (
    <section
      aria-labelledby="embed-similarity-heading"
      className="space-y-4"
      data-testid="embed-similarity"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
          <BarChart3 aria-hidden className="text-primary h-3.5 w-3.5" />
        </div>
        <h3
          id="embed-similarity-heading"
          className="text-foreground text-sm font-medium"
        >
          Similarity
        </h3>
        <InfoTip
          ariaLabel="Info about similarity"
          contentClassName="max-w-64"
          tooltip="Cosine similarity measures how close two inputs are in meaning. Scores range from 0 (unrelated) to 1 (identical meaning). Image-to-text scores of CLIP-style models are lower in absolute terms; the ranking is what matters."
        />
        {done && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="embed-copy-results"
              onClick={() => void copy(similarityText(ranked, subject))}
            >
              {copied ? (
                <Check aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Copy aria-hidden className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy results'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="embed-download-results"
              onClick={() =>
                downloadBlob(
                  new Blob([similarityCsv(ranked, subject)], {
                    type: 'text/csv;charset=utf-8',
                  }),
                  'similarity.csv',
                )
              }
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              Download CSV
            </Button>
          </div>
        )}
      </div>

      {subject && (
        <div className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="shrink-0">Compared with</span>
          <TruncatedText
            text={describeSubject(subject)}
            className="text-foreground"
            data-testid="embed-compared-subject"
          />
        </div>
      )}

      {pending && (
        <div
          role="status"
          className="border-border bg-muted/10 flex h-24 items-center justify-center gap-2 rounded-xl border"
        >
          <Loader aria-hidden className="text-primary h-5 w-5 animate-spin" />
          <span className="text-muted-foreground text-sm">Comparing…</span>
        </div>
      )}

      {ranked.length > 0 && (
        <ol className="space-y-3" aria-label="References, most similar first">
          {ranked.map((item, rank) => {
            const level = similarityLevel(item.score)
            const percent = Math.round(item.score * 100)
            return (
              // The same text may be listed twice: its position tells them apart.
              <li
                key={`${item.index}-${item.text}`}
                className="border-border bg-muted/10 space-y-2.5 rounded-xl border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-foreground min-w-0 text-sm leading-snug break-words">
                    <span className="text-muted-foreground mr-1.5 font-mono text-xs">
                      {rank + 1}.
                    </span>
                    <span>&ldquo;{item.text}&rdquo;</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={LEVEL_STYLE[level].badge}
                      className="text-xs"
                    >
                      {level}
                    </Badge>
                    <span className="text-foreground min-w-[3ch] text-right font-mono text-lg font-semibold">
                      {percent}
                      <span className="text-muted-foreground text-xs font-normal">
                        %
                      </span>
                    </span>
                  </div>
                </div>
                <Progress
                  value={Math.max(0, percent)}
                  aria-label={`Similarity to “${item.text}”`}
                  indicatorClassName={LEVEL_STYLE[level].bar}
                />
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
