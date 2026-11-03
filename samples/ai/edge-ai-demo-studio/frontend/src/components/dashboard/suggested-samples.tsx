// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ArrowRight,
  CheckCircle2,
  History,
  Layers3,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { type Tone, TONES } from '@/components/common/tones'
import { useReadinessFlags } from '@/components/samples/hooks/use-readiness-flags'
import { SampleCard } from '@/components/samples/sample-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceStatus } from '@/context/service-status-context'
import { useRecentWork } from '@/hooks/use-service-shortcuts'
import { useResolvedSampleBindings } from '@/hooks/use-sample-settings'
import { cn } from '@/lib/utils'
import {
  computeSampleReadinessView,
  type SampleReadinessView,
} from '@/samples/common/readiness'
import { samples } from '@/samples/registry'
import { getRequiredDeps, type Sample } from '@/samples/types'
import { getServiceById } from '@/services/registry'

/** Why a sample is suggested, strongest reason first. */
type SuggestionKind = 'ready' | 'recent' | 'partial' | 'starter'

export interface SampleSuggestion {
  sample: Sample
  kind: SuggestionKind
  reason: string
}

const SHOWN = 3

/**
 * Fallback suggestions, in order: a short path to a first result on a typical machine. Not simply
 * the fewest services: a suite or a Geti model needs one service but a deployment of its own.
 */
const STARTER_SAMPLES = [
  'rag-chatbot',
  'webcam-vlm',
  'ppt-translator',
  'digital-avatar-lite',
]

/** "Text Generation, Text Embedding and Vector Database". */
function requiredServiceNames(sample: Sample): string {
  const names = getRequiredDeps(sample).map(
    (d) => getServiceById(d.serviceId)?.name ?? d.serviceId,
  )
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '')
}

const KIND_STYLE: Record<SuggestionKind, { icon: LucideIcon; tone: Tone }> = {
  ready: { icon: CheckCircle2, tone: 'success' },
  recent: { icon: History, tone: 'muted' },
  partial: { icon: Layers3, tone: 'primary' },
  starter: { icon: Sparkles, tone: 'info' },
}

interface Candidate {
  sample: Sample
  view: SampleReadinessView
  /** Required services already in the workspace (added). */
  added: number
}

const byTitle = (a: Candidate, b: Candidate) =>
  a.sample.title.localeCompare(b.sample.title)

/**
 * Ranks samples: ready to try, opened recently, partly set up, then the starters. Unsupported
 * samples are never suggested; without service status only recent and starters apply.
 */
function rankSuggestions(
  candidates: readonly Candidate[],
  recentIds: readonly string[],
  statusKnown: boolean,
  limit: number,
): SampleSuggestion[] {
  const eligible = candidates.filter(({ view }) => view.state !== 'unsupported')
  const recentRank = (id: string) => {
    const at = recentIds.indexOf(id)
    return at === -1 ? Number.POSITIVE_INFINITY : at
  }
  const picked: SampleSuggestion[] = []
  const take = (
    list: readonly Candidate[],
    kind: SuggestionKind,
    reason: (c: Candidate) => string,
  ) => {
    for (const c of list) {
      if (picked.length >= limit) return
      if (picked.some((p) => p.sample.id === c.sample.id)) continue
      picked.push({ sample: c.sample, kind, reason: reason(c) })
    }
  }

  if (statusKnown) {
    take(
      eligible
        .filter((c) => c.view.state === 'ready' && c.view.requiredTotal > 0)
        .sort(
          (a, b) =>
            recentRank(a.sample.id) - recentRank(b.sample.id) || byTitle(a, b),
        ),
      'ready',
      () => 'Ready to try: its services are running',
    )
  }
  take(
    recentIds.flatMap((id) => eligible.filter((c) => c.sample.id === id)),
    'recent',
    () => 'You opened it recently',
  )
  if (statusKnown) {
    take(
      eligible
        .filter((c) => c.added > 0)
        .sort(
          (a, b) =>
            b.added / b.view.requiredTotal - a.added / a.view.requiredTotal ||
            byTitle(a, b),
        ),
      'partial',
      (c) =>
        c.added === c.view.requiredTotal
          ? 'Its services are added: start them to try it'
          : `${c.added} of the ${c.view.requiredTotal} services it needs are in your workspace`,
    )
  }
  take(
    STARTER_SAMPLES.flatMap((id) => eligible.filter((c) => c.sample.id === id)),
    'starter',
    (c) => `Good first sample: uses ${requiredServiceNames(c.sample)}`,
  )
  return picked
}

/**
 * Suggested samples, from each sample's readiness as its own page judges it (bindings included).
 * `settled` is false while inputs load, so the section holds its place instead of reordering cards.
 */
export function useSampleSuggestions(limit = SHOWN): {
  suggestions: SampleSuggestion[]
  settled: boolean
} {
  const { serviceById } = useServiceStatus()
  const bindings = useResolvedSampleBindings()
  const flags = useReadinessFlags()
  const recent = useRecentWork()

  const candidates: Candidate[] = samples.map((sample) => {
    const bound = bindings[sample.id]
    const view = computeSampleReadinessView(sample, {
      ...flags,
      resolve: (type) => serviceById.get(bound?.[type] ?? type),
      typeView: (type) => serviceById.get(type),
      boundKey: (type) => bound?.[type],
    })
    const added = getRequiredDeps(sample).filter(
      (d) => serviceById.get(d.serviceId)?.added,
    ).length
    return { sample, view, added }
  })
  const recentIds = recent.flatMap((v) => (v.kind === 'sample' ? [v.id] : []))
  const settled = !flags.statusLoading && !flags.systemLoading
  const statusKnown =
    settled && !flags.statusUnavailable && !flags.bindingsUnavailable

  return {
    suggestions: settled
      ? rankSuggestions(candidates, recentIds, statusKnown, limit)
      : [],
    settled,
  }
}

/** Three samples worth opening next, each with the reason it is suggested. */
export function SuggestedSamples({
  suggestions,
  settled,
}: {
  suggestions: readonly SampleSuggestion[]
  /** False while readiness loads: placeholders hold the section's place. */
  settled: boolean
}) {
  return (
    <section
      className="section-fade"
      style={{ '--stagger': 2 } as CSSProperties}
      aria-labelledby="samples-title"
      aria-busy={!settled}
      data-testid="suggested-samples"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="samples-title" className="text-lg font-semibold tracking-tight">
          Suggested samples
        </h2>
        <Link
          href="/samples"
          className="view-all-link text-primary flex items-center gap-1.5 text-xs font-semibold"
        >
          View gallery
          <ArrowRight aria-hidden="true" className="view-all-arrow size-3.5" />
        </Link>
      </div>
      {settled && suggestions.length === 0 && (
        <p className="text-muted-foreground text-sm">
          None of the samples can run on this machine. The gallery lists each
          one with what it needs.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!settled
          ? Array.from({ length: SHOWN }).map((_, i) => (
              <SampleCardSkeleton key={i} />
            ))
          : suggestions.map(({ sample, kind, reason }, i) => (
              <div
                key={sample.id}
                className="card-stagger"
                style={{ '--card-index': i } as CSSProperties}
              >
                <SampleCard
                  sample={sample}
                  reason={<SuggestionReason kind={kind} reason={reason} />}
                />
              </div>
            ))}
      </div>
    </section>
  )
}

function SuggestionReason({
  kind,
  reason,
}: {
  kind: SuggestionKind
  reason: string
}) {
  const { icon: Icon, tone } = KIND_STYLE[kind]
  return (
    <p
      className="text-foreground flex items-start gap-1.5 text-xs font-medium"
      data-testid="sample-suggestion-reason"
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-px size-3.5 shrink-0', TONES[tone].text)}
      />
      {reason}
    </p>
  )
}

function SampleCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="surface-panel overflow-hidden rounded-2xl"
    >
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </div>
  )
}
