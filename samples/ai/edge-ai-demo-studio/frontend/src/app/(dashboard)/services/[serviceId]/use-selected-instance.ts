// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceInstances } from '@/context/service-status-context'
import { useUrlSearchState } from '@/hooks/use-url-search-state'
import type { InstanceTab } from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'

/** `overview` exists only while the service has not been added. */
export type ServiceTab = 'overview' | InstanceTab

/**
 * The shown instance and tab, kept in `?instance=<id>&tab=<tab>`; the only writer of either. Falls
 * back to the first instance when `?instance` is absent or unknown.
 */
export function useSelectedInstance(serviceType: string): {
  instance: ServiceInstance | undefined
  instances: ServiceInstance[]
  /** `?tab` as given; the tabs decide which of it they can show. */
  requestedTab: string | null
  /** Shows an instance (an empty id: the first), optionally on one tab. */
  select: (instanceId: string, tab?: InstanceTab) => void
  /** Switches tab; the old tab's `#anchor` goes with it. */
  setTab: (tab: ServiceTab) => void
} {
  const [searchParams, writeSearchParams] = useUrlSearchState()
  const instances = useServiceInstances(serviceType)
  const first = instances[0]

  const requested = searchParams.get('instance')
  const instance =
    (requested && instances.find((i) => i.instanceId === requested)) || first

  const select = (instanceId: string, tab?: InstanceTab) =>
    writeSearchParams(
      {
        // The first instance is the default: its address carries no id.
        instance:
          !instanceId || instanceId === first?.instanceId ? null : instanceId,
        ...(tab && { tab }),
      },
      { clearHash: Boolean(tab) },
    )

  const setTab = (tab: ServiceTab) =>
    writeSearchParams({ tab }, { clearHash: true })

  return {
    instance,
    instances,
    requestedTab: searchParams.get('tab'),
    select,
    setTab,
  }
}
