// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceStatus } from '@/context/service-status-context'
import { parseCpuAffinity } from '@/lib/instances/cpu-affinity'
import { getServiceMetadata } from '@/lib/instances/service-metadata'

/** Another instance that pins a core. */
export interface CoreConflict {
  instanceKey: string
  /** Its name as every surface shows it. */
  label: string
}

/** Core id → the other instances pinning it. */
export type CpuAffinityConflicts = Readonly<Record<number, CoreConflict[]>>

/**
 * The CPU cores every other instance is pinned to. `currentInstanceKey` (an exact instance key, not a
 * bare service type) is excluded; `undefined` while drafting a new instance.
 */
export function useCpuAffinityConflicts(
  currentInstanceKey: string | undefined,
): CpuAffinityConflicts {
  const { serviceInfoMap } = useServiceStatus()
  const conflicts: Record<number, CoreConflict[]> = {}
  for (const info of Object.values(serviceInfoMap)) {
    if (info.instanceKey === currentInstanceKey) continue
    const affinity = getServiceMetadata(info).cpuAffinity
    if (!affinity) continue
    for (const core of parseCpuAffinity(affinity)) {
      ;(conflicts[core] ??= []).push({
        instanceKey: info.instanceKey,
        label: info.label,
      })
    }
  }
  return conflicts
}
