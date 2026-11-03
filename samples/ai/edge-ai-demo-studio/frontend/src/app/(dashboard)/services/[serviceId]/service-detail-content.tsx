// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useGetService,
  useServiceStatus,
} from '@/context/service-status-context'
import { hasExecutionMode } from '@/services/execution'
import { ServiceDetailTabs } from './tabs'
import { useSelectedInstance } from './use-selected-instance'

function ServiceDetailContentInner({ serviceId }: { serviceId: string }) {
  const service = useGetService(serviceId)
  const { loading } = useServiceStatus()
  const { instance, instances, requestedTab, select, setTab } =
    useSelectedInstance(serviceId)

  if (!service) return null

  // A service that runs inside the studio (`none`) has no instance to add.
  const instanceAvailable =
    hasExecutionMode(service.execution, 'none') || instances.length > 0

  return (
    <ServiceDetailTabs
      serviceId={serviceId}
      selected={instance}
      instances={instances}
      onSelect={select}
      requestedTab={requestedTab}
      onTabChange={setTab}
      loading={loading}
      instanceAvailable={instanceAvailable}
    />
  )
}

export function ServiceDetailContent({ serviceId }: { serviceId: string }) {
  return (
    <Suspense fallback={<ServiceDetailSkeleton />}>
      <ServiceDetailContentInner serviceId={serviceId} />
    </Suspense>
  )
}

function ServiceDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading service…</span>
      <div
        aria-hidden="true"
        className="border-border bg-card space-y-3 rounded-xl border p-3"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="ml-auto h-8 w-28 rounded-md" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
        </div>
      </div>
      <Skeleton aria-hidden="true" className="h-80 w-full rounded-xl" />
    </div>
  )
}
