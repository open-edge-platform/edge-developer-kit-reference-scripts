// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  accent,
  className,
  index = 0,
}: {
  label: string
  value: string
  unit?: string
  icon?: LucideIcon
  accent?: 'blue' | 'cyan' | 'green' | 'amber'
  className?: string
  index?: number
}) {
  const accentStyles = {
    blue: 'text-primary',
    cyan: 'text-secondary',
    green: 'text-status-online',
    amber: 'text-warning',
  }

  return (
    <div
      className={cn(
        'glass-card card-lift card-stagger rounded-xl px-5 py-4',
        className,
      )}
      style={{ '--card-index': index } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {label}
        </p>
        {Icon && (
          <Icon
            className={cn(
              'text-muted-foreground/50 h-4 w-4',
              accent && accentStyles[accent],
            )}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            'metric-pop text-foreground text-2xl font-bold',
            accent && accentStyles[accent],
          )}
          style={{ '--card-index': index } as React.CSSProperties}
        >
          {value}
        </span>
        {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
      </div>
    </div>
  )
}
