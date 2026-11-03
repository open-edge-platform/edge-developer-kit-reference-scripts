// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { TONES, type Tone } from '@/components/common/tones'
import { cn } from '@/lib/utils'

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
  className,
  index = 0,
  href,
}: {
  label: string
  value: string
  unit?: string
  icon?: LucideIcon
  /** Colours the value and icon; neutral without one. */
  tone?: Extract<Tone, 'primary' | 'info' | 'success' | 'warning'>
  className?: string
  /** Position in the row's staggered entrance. */
  index?: number
  /** The page the figure is about: the whole card links there. */
  href?: string
}) {
  const toneText = tone && TONES[tone].text
  const cardClassName = cn(
    'glass-card card-stagger rounded-2xl px-5 py-5',
    href &&
      'card-lift focus-visible:ring-ring/50 block outline-none focus-visible:ring-[3px]',
    className,
  )
  const style = { '--card-index': index } as CSSProperties

  const content = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
        {Icon && (
          <Icon
            aria-hidden="true"
            className={cn('text-muted-foreground/60 h-4 w-4', toneText)}
          />
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            'metric-pop text-foreground text-3xl font-semibold tracking-tight tabular-nums',
            toneText,
          )}
          style={{ '--card-index': index } as CSSProperties}
        >
          {value}
        </span>
        {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
      </div>
    </>
  )

  return href ? (
    <Link href={href} className={cardClassName} style={style}>
      {content}
    </Link>
  ) : (
    <div className={cardClassName} style={style}>
      {content}
    </div>
  )
}
