// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { cn } from '@/lib/utils'

/** One term and its right-aligned, truncated value in a `<dl>` of facts. */
export function FactRow({
  label,
  value,
  size = 'sm',
}: {
  label: string
  value: ReactNode
  size?: 'xs' | 'sm'
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3',
        size === 'xs' ? 'text-xs' : 'text-sm',
      )}
    >
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 truncate text-right font-medium">
        {typeof value === 'string' ? (
          <TruncatedText text={value} className="ml-auto w-fit max-w-full" />
        ) : (
          value
        )}
      </dd>
    </div>
  )
}
