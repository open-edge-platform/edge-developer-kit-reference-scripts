// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatusCardProps {
  /** Fully-rendered icon element (colour/size already applied by the caller). */
  icon: ReactNode
  iconWrapClassName: string
  label: string
  value: string
  valueClassName?: string
  sub?: ReactNode
}

/** One tile in the demo header's status row. */
export function StatusCard({
  icon,
  iconWrapClassName,
  label,
  value,
  valueClassName,
  sub,
}: StatusCardProps) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
      <div
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
          iconWrapClassName,
        )}
      >
        {icon}
      </div>
      <dl className="min-w-0">
        <dt className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {label}
        </dt>
        <dd className={cn('truncate text-sm font-semibold', valueClassName)}>
          {value}
        </dd>
        {sub && <dd>{sub}</dd>}
      </dl>
    </div>
  )
}
