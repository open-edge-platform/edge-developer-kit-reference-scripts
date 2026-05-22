// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import type { ServiceStatus } from '@/services/types'

const statusConfig: Record<
  ServiceStatus,
  {
    label: string
    dotClass: string
    textClass: string
    bgClass: string
    borderClass: string
  }
> = {
  online: {
    label: 'Online',
    dotClass: 'bg-success text-success/40 status-glow',
    textClass: 'text-success',
    bgClass: 'bg-success/10',
    borderClass: 'border border-success/20',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-muted-foreground/50',
    textClass: 'text-muted-foreground',
    bgClass: 'bg-muted/50',
    borderClass: 'border border-border',
  },
  error: {
    label: 'Error',
    dotClass: 'bg-red-500 text-red-500/40 status-glow',
    textClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border border-red-500/20',
  },
  starting: {
    label: 'Starting',
    dotClass: 'bg-warning animate-pulse',
    textClass: 'text-warning',
    bgClass: 'bg-warning/10',
    borderClass: 'border border-warning/20',
  },
}

export function StatusIndicator({
  status,
  size = 'sm',
}: {
  status: ServiceStatus
  size?: 'sm' | 'md'
}) {
  const config = statusConfig[status]
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
        config.bgClass,
        config.borderClass,
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded-full',
          config.dotClass,
          size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        )}
      />
      <span
        className={cn(
          'font-medium',
          config.textClass,
          size === 'sm' ? 'text-[11px]' : 'text-xs',
        )}
      >
        {config.label}
      </span>
    </div>
  )
}
