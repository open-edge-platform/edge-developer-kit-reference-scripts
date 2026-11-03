// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type { EngineBackend } from './types'

import type { Service } from '@/payload-types'
import type { HostOS } from '@/types/common'
import { engines } from './_generated/meta'
import type { EngineBackend } from './types'

export { engines } from './_generated/meta'

function getBackendsForService(
  serviceType: Service['type'],
  engineId?: string,
): EngineBackend[] {
  return Object.entries(engines)
    .filter(([id]) => engineId === undefined || id === engineId)
    .flatMap(([, engine]) =>
      engine.supportedBackends.filter((b) =>
        b.supportedServices.includes(serviceType),
      ),
    )
}

/**
 * Default backend for a service type on `os` (of one engine when `engineId` is given): the one
 * recommended for that OS, else the first that supports it, else the first.
 */
export function getRecommendedBackendForService(
  serviceType: Service['type'],
  os: HostOS,
  engineId?: string,
): EngineBackend | undefined {
  const backends = getBackendsForService(serviceType, engineId)
  const supports = (b: EngineBackend) => b.supportedOS.some((o) => o === os)
  return (
    backends.find((b) => b.recommendedOS === os && supports(b)) ??
    backends.find(supports) ??
    backends[0]
  )
}

export function getBackendByValue(value: string): EngineBackend | undefined {
  for (const engine of Object.values(engines)) {
    const found = engine.supportedBackends.find((b) => b.value === value)
    if (found) return found
  }
  return undefined
}
