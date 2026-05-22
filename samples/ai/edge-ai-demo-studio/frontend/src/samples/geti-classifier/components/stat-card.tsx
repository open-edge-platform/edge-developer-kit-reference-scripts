// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import { PHASE_CONFIG } from '../constants'

interface StatCardProps {
  label: string
  value: string
  icon: React.ElementType
  phase: 'seg' | 'cls'
}

export function StatCard({ label, value, icon: Icon, phase }: StatCardProps) {
  const config = PHASE_CONFIG[phase]

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        config.lightBg,
        config.border,
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={cn('h-3 w-3', config.accent)} />
        <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {label}
        </span>
      </div>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  )
}
