// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import type { SampleReadinessView } from '@/samples/common/readiness'
import { readinessStyle } from './readiness-styles'

interface ReadinessSummaryProps {
  view: SampleReadinessView
  /** `line`: icon + label (+ detail) in the flow; `pill`: a bordered chip for toolbars. */
  variant?: 'line' | 'pill'
  showDetail?: boolean
  className?: string
}

/** The readiness summary every sample surface shows, so a state looks the same everywhere. */
export function ReadinessSummary({
  view,
  variant = 'line',
  showDetail = false,
  className,
}: ReadinessSummaryProps) {
  const style = readinessStyle(view.state)
  const Icon = style.icon

  if (variant === 'pill') {
    return (
      <span
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
          style.pill,
          className,
        )}
      >
        <Icon
          className={cn('h-3.5 w-3.5 shrink-0', style.spin && 'animate-spin')}
          aria-hidden
        />
        <span className="truncate">{view.label}</span>
        {view.staleNote && (
          <span className="text-muted-foreground font-normal">
            · may be out of date
          </span>
        )}
      </span>
    )
  }

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <span
        className={cn(
          'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
          style.iconBg,
        )}
      >
        <Icon
          className={cn('h-3 w-3', style.text, style.spin && 'animate-spin')}
          aria-hidden
        />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'text-xs leading-snug font-medium transition-colors duration-200',
            style.text,
          )}
        >
          {view.label}
        </p>
        {showDetail && view.detail && (
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {view.detail}
          </p>
        )}
        {view.staleNote && (
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {view.staleNote}
          </p>
        )}
      </div>
    </div>
  )
}
