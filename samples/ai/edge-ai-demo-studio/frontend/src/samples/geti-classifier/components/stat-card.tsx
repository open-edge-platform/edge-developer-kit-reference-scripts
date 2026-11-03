// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeployPhase } from '../lib/api'
import { PHASES } from '../lib/wizard'

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  phase: DeployPhase
}

/** One setting of a phase's configuration summary. */
export function StatCard({ label, value, icon: Icon, phase }: StatCardProps) {
  const style = PHASES[phase]

  return (
    <div className={cn('rounded-lg border p-3', style.surface)}>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={cn('h-3 w-3', style.text)} aria-hidden />
        <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {label}
        </span>
      </div>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  )
}
