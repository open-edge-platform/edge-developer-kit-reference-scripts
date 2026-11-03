// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from '@/components/ui/skeleton'

/** Placeholder with the usual demo shape: input on one side, result on the other. */
export function DemoShellSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid gap-4 lg:grid-cols-2"
      data-testid="demo-loading"
    >
      <span className="sr-only">Loading demo…</span>
      <div
        aria-hidden="true"
        className="border-border space-y-3 rounded-xl border p-4"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="ml-auto h-9 w-28 rounded-md" />
      </div>
      <div
        aria-hidden="true"
        className="border-border space-y-3 rounded-xl border p-4"
      >
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}
