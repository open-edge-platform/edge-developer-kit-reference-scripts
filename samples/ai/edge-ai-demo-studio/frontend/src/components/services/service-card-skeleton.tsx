// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from '@/components/ui/skeleton'

/** Loading placeholder for a `ServiceCard`; `lines={3}` matches a card's wrapped description. */
export function ServiceCardSkeleton({ lines = 3 }: { lines?: 2 | 3 }) {
  return (
    <div aria-hidden="true" className="glass-card min-h-48 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          {lines === 3 && <Skeleton className="h-3 w-2/3" />}
        </div>
      </div>
      <Skeleton className="mt-5 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  )
}
