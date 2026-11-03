// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'

/** A small round count beside a label; muted at zero. */
export function CountPill({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors',
        count > 0
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {count}
    </span>
  )
}
