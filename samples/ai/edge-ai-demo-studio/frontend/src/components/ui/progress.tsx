// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Determinate (`value` 0–100), or indeterminate when `value` is null/undefined. Pass an
 * `aria-label` (or `aria-labelledby`) naming what is progressing.
 */
function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** Classes for the filled part, e.g. a tone (`bg-success`). */
  indicatorClassName?: string
}) {
  const percent =
    value === null || value === undefined
      ? null
      : Math.min(100, Math.max(0, value))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-muted relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      value={percent}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'bg-primary h-full w-full flex-1 rounded-full transition-transform',
          percent === null && 'animate-pulse opacity-60',
          indicatorClassName,
        )}
        style={
          percent === null
            ? undefined
            : { transform: `translateX(-${100 - percent}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
