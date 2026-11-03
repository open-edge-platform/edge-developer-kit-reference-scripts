// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from '@/components/ui/skeleton'

/** Demo workspace placeholder in the shape most samples take, so the page does not jump on load. */
export function DemoWorkspaceSkeleton({
  withToolbar = false,
}: {
  withToolbar?: boolean
}) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading the demo workspace…</span>
      {withToolbar && (
        <>
          <Skeleton className="h-4 w-40" />
          <div className="surface-panel flex items-center gap-3 rounded-xl px-4 py-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-6 w-28 rounded-full" />
            <div className="ml-auto flex gap-2">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        </>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="surface-panel space-y-3 rounded-xl p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="surface-panel flex min-h-[420px] flex-col rounded-xl p-4">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
