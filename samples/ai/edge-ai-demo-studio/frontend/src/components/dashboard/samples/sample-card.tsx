// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Ban, Check, ExternalLink, ImageIcon, Monitor } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { OS } from '@/types/common'
import { getReadinessLabel } from '@/samples/registry'
import type { Sample } from '@/samples/types'
import { getCategoryLabels, getRequiredDeps } from '@/samples/types'
import { computeSampleReadiness } from '@/samples/common/util'
import { useServiceStatus } from '@/context/service-status-context'

const readinessStyle: Record<
  string,
  { dot: string; text: string; bg: string }
> = {
  ready: {
    dot: 'bg-success',
    text: 'text-success',
    bg: 'bg-success/10 border-success/20',
  },
  partial: {
    dot: 'bg-info',
    text: 'text-info',
    bg: 'bg-info/10 border-info/20',
  },
  blocked: {
    dot: 'bg-muted-foreground/50',
    text: 'text-muted-foreground',
    bg: 'bg-muted/90 border-border',
  },
}

interface SampleCardProps {
  sample: Sample
  unsupported?: boolean
  unsupportedReason?: string
  currentOS?: OS
  /** When true, the card toggles selection instead of navigating. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}

export function SampleCard({
  sample,
  unsupported,
  unsupportedReason,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SampleCardProps) {
  const { services } = useServiceStatus()
  const readiness = computeSampleReadiness(sample, services)
  const readinessLabel = getReadinessLabel(readiness)
  const rs = readinessStyle[readiness]
  const categoryLabels = getCategoryLabels(sample)
  const displayTags = sample.tags.filter((tag) => !categoryLabels.includes(tag))

  const requiredServiceDetails = getRequiredDeps(sample)
    .map((dep) => services.find((s) => s.id === dep.serviceId))
    .filter(Boolean)

  const card = (
    <div
      className={cn(
        'glass-card group relative flex h-full flex-col overflow-hidden rounded-xl transition-shadow',
        unsupported && !selectable
          ? 'cursor-not-allowed opacity-50'
          : 'card-lift cursor-pointer',
        selectable && 'cursor-pointer',
        selected &&
          'ring-primary ring-offset-background border-primary/60 shadow-primary/10 ring-2 ring-offset-2',
      )}
    >
      {selectable && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              'absolute top-2.5 left-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-md backdrop-blur-sm transition-all duration-200',
              selected
                ? 'bg-primary shadow-primary/30 shadow-sm ring-0'
                : 'bg-black/45 ring-1 ring-white/60 group-hover:bg-black/60',
            )}
          >
            <span
              className={cn(
                'flex size-4 items-center justify-center rounded-[4px] border transition-colors',
                selected
                  ? 'border-white text-white'
                  : 'border-white/80 bg-white/15',
              )}
            >
              {selected && <Check className="size-3" strokeWidth={3} />}
            </span>
          </div>
          {selected && (
            <span className="bg-primary/8 pointer-events-none absolute inset-0 z-[5] rounded-xl" />
          )}
        </>
      )}
      <div className="relative aspect-[16/9] w-full">
        {sample.image ? (
          <Image
            src={sample.image}
            alt={sample.title}
            fill
            className={cn('object-cover', unsupported && 'grayscale')}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center',
              unsupported
                ? 'bg-muted/50 grayscale'
                : 'from-primary/20 via-secondary/10 to-intel-teal/5 bg-gradient-to-br',
            )}
          >
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="text-muted-foreground/40 h-8 w-8" />
              <span className="text-muted-foreground/60 text-xs font-medium">
                {categoryLabels.join(' • ')}
              </span>
            </div>
          </div>
        )}

        <div className="absolute top-2.5 right-2.5">
          {unsupported ? (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-orange-400/20 bg-orange-500/10 text-[10px] text-orange-400 backdrop-blur-sm"
            >
              <Ban className="h-2.5 w-2.5" />
              Unsupported
            </Badge>
          ) : (
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur-sm',
                rs.bg,
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', rs.dot)}
              />
              <span className={cn('text-[11px] font-medium', rs.text)}>
                {readinessLabel}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              'text-sm font-semibold transition-colors',
              unsupported
                ? 'text-muted-foreground'
                : 'text-foreground group-hover:text-primary-light',
            )}
          >
            {sample.title}
          </h3>
        </div>
        <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed">
          {sample.description}
        </p>

        {unsupported && unsupportedReason && (
          <div className="mt-3 flex items-center gap-1.5 rounded-md border border-orange-500/10 bg-orange-500/5 px-2.5 py-1.5">
            <Monitor className="h-3 w-3 shrink-0 text-orange-400" />
            <span className="text-[11px] text-orange-400">
              {unsupportedReason}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-1.5">
          {categoryLabels.map((label) => (
            <Badge key={label} variant="default" className="text-[11px]">
              {label}
            </Badge>
          ))}
          {displayTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[11px]">
              {tag}
            </Badge>
          ))}
          {sample.demo.type === 'external' && (
            <Badge
              variant="outline"
              className="text-muted-foreground gap-1 text-[11px]"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              External UI
            </Badge>
          )}
        </div>

        <div className="border-border mt-4 border-t pt-3">
          <p className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
            Required Services
          </p>
          <div className="flex flex-wrap gap-1.5">
            {requiredServiceDetails.map(
              (s) =>
                s && (
                  <div
                    key={s.id}
                    className="bg-muted/50 flex items-center gap-1.5 rounded-md px-2 py-1"
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        s.status === 'online'
                          ? 'bg-status-online'
                          : 'bg-status-offline',
                      )}
                    />
                    <span className="text-muted-foreground text-[11px]">
                      {s.name}
                    </span>
                  </div>
                ),
            )}
          </div>
        </div>
      </div>
    </div>
  )

  if (selectable) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect?.(sample.id)}
        aria-pressed={selected}
        aria-label={`Select ${sample.title}`}
        className="block w-full text-left"
      >
        {card}
      </button>
    )
  }

  if (unsupported) {
    return card
  }

  return <Link href={`/samples/${sample.id}`}>{card}</Link>
}
