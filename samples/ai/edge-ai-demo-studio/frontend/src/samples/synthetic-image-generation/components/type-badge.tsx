// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import { GenerationType } from '../lib/api'

const TYPE_CLASS: Record<GenerationType, string> = {
  [GenerationType.GOOD_DATASET]: 'border-primary bg-primary',
  [GenerationType.MISSING_COMPONENTS]: 'border-warning bg-warning',
  [GenerationType.CUSTOM]: 'border-success bg-success',
}

/** The generation type of an image, as a solid chip over its thumbnail. */
export function TypeBadge({ type }: { type: GenerationType }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs font-bold text-white uppercase',
        TYPE_CLASS[type],
      )}
    >
      {type.split('_')[0]}
    </span>
  )
}
