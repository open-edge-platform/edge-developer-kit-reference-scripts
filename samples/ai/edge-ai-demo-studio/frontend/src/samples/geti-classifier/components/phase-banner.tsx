// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PHASES, type Phase } from '../lib/wizard'

interface PhaseBannerProps {
  phase: Phase
  title: string
  subtitle: string
  /** The phase's own icon unless given. */
  icon?: LucideIcon
}

/** The tinted banner opening each wizard step: where it is, what it does. */
export function PhaseBanner({
  phase,
  title,
  subtitle,
  icon,
}: PhaseBannerProps) {
  const style = PHASES[phase]
  const Icon = icon ?? style.icon

  return (
    <div className={cn('rounded-xl border p-4', style.surface)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg shadow-sm',
            style.solid,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className={cn('text-sm font-semibold', style.text)}>{title}</p>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}
