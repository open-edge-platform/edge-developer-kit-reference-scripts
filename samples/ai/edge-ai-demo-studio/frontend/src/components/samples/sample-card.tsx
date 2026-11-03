// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowRight, Ban, Check, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSystemInfo } from '@/context/system-info-context'
import { cn } from '@/lib/utils'
import { describeSampleCompatibility } from '@/samples/common/readiness'
import { getCategoryLabels } from '@/samples/types'
import type { Sample } from '@/samples/types'
import { SamplePreviewImage } from './sample-preview-image'

interface SampleCardProps {
  sample: Sample
  /** When true, the card toggles selection instead of offering its action. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** Why the sample is shown here (e.g. a dashboard suggestion), above the card's action. */
  reason?: ReactNode
}

/**
 * One gallery card. Live readiness is left to the detail page; only a hardware/OS restriction shows.
 * The title link stretches over the card; only the action sits above it.
 */
export function SampleCard({
  sample,
  selectable = false,
  selected = false,
  onToggleSelect,
  reason,
}: SampleCardProps) {
  const { systemInfo } = useSystemInfo()
  const compatibility = systemInfo
    ? describeSampleCompatibility(sample, systemInfo)
    : undefined
  const unsupported = compatibility !== undefined && !compatibility.supported
  const category = getCategoryLabels(sample)[0]
  const detailsHref = `/samples/${sample.id}`
  const isExternal = sample.demo.type === 'external'
  const titleId = `sample-card-${sample.id}-title`
  const hasFooter = !selectable || unsupported

  const preview = (
    <div className="bg-muted relative aspect-video w-full overflow-hidden">
      <SamplePreviewImage
        sample={sample}
        className={cn(
          'object-cover transition-transform duration-500',
          !selectable && 'group-hover:scale-[1.03]',
        )}
        sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
      />
      {isExternal && (
        <span className="bg-background/85 text-foreground absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
          <ExternalLink className="h-3 w-3" aria-hidden />
          Opens externally
        </span>
      )}
    </div>
  )

  const body = (
    <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-5">
      <div className="flex items-start justify-between gap-3">
        <h3
          id={titleId}
          className="text-foreground text-base leading-snug font-semibold"
        >
          {selectable ? (
            sample.title
          ) : (
            <Link
              href={detailsHref}
              className="hover:text-primary rounded-sm transition-colors after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              {sample.title}
            </Link>
          )}
        </h3>
        {category && (
          <Badge variant="secondary" className="shrink-0 text-xs">
            {category}
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
        {sample.description}
      </p>
      {hasFooter && (
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {reason}
          {compatibility && !compatibility.supported && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {compatibility.reason}
            </p>
          )}
          {!selectable && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="relative z-10 self-start"
            >
              <Link href={detailsHref}>
                View sample
                <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )

  if (selectable) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect?.(sample.id)}
        aria-pressed={selected}
        aria-label={`Select ${sample.title}`}
        className="focus-visible:ring-ring/50 block w-full rounded-2xl text-left outline-none focus-visible:ring-[3px]"
      >
        <div
          data-testid={`sample-card-${sample.id}`}
          className={cn(
            'surface-panel group relative flex h-full flex-col overflow-hidden rounded-2xl transition-[border-color,box-shadow] duration-150',
            selected
              ? 'border-primary/60 shadow-primary/10 ring-primary shadow-md ring-2'
              : 'hover:border-primary/40',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-2.5 left-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-md ring-1 backdrop-blur-sm transition-colors duration-150',
              selected
                ? 'bg-primary text-primary-foreground ring-primary'
                : 'bg-background/85 ring-border text-transparent',
            )}
          >
            <Check
              className={cn(
                'size-4 transition-opacity duration-150',
                selected ? 'opacity-100' : 'opacity-0',
              )}
              strokeWidth={3}
            />
          </span>
          {selected && (
            <span className="bg-primary/8 pointer-events-none absolute inset-0 z-[5]" />
          )}
          {preview}
          {body}
          <p className="text-muted-foreground px-5 pb-4 text-xs">
            {selected ? 'Selected for export' : 'Select for export'}
          </p>
        </div>
      </button>
    )
  }

  return (
    <article
      aria-labelledby={titleId}
      data-testid={`sample-card-${sample.id}`}
      className="surface-panel card-lift group relative flex h-full flex-col overflow-hidden rounded-2xl focus-within:ring-2 focus-within:ring-[var(--ring)]/50"
    >
      {preview}
      {body}
    </article>
  )
}
