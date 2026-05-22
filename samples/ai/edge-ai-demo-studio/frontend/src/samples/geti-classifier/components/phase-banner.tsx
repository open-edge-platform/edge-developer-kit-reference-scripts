// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import { PHASE_CONFIG } from '../constants'

interface PhaseBannerProps {
  phase: 'connect' | 'seg' | 'cls'
  title: string
  subtitle: string
  icon: React.ElementType
}

export function PhaseBanner({
  phase,
  title,
  subtitle,
  icon: Icon,
}: PhaseBannerProps) {
  const config = PHASE_CONFIG[phase]

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border p-4',
        config.lightBg,
        config.border,
      )}
    >
      {/* Decorative circles */}
      <div
        className={cn(
          'absolute -top-6 -right-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-10',
          config.gradient,
        )}
      />
      <div
        className={cn(
          'absolute -right-2 -bottom-4 h-12 w-12 rounded-full bg-gradient-to-br opacity-5',
          config.gradient,
        )}
      />

      <div className="relative flex items-center gap-3">
        <div
          className={cn(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm',
            config.gradient,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className={cn('text-sm font-semibold', config.text)}>{title}</p>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}
