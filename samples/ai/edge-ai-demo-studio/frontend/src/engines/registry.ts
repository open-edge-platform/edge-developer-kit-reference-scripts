// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type { Engine, EngineBackend } from './types'

import type { Service } from '@/payload-types'
import type { OS } from '@/types/common'
import { engines } from './_generated/meta'
import type { EngineBackend } from './types'

export { engines } from './_generated/meta'

export function getBackendsForService(
  serviceType: Service['type'],
): EngineBackend[] {
  return Object.values(engines).flatMap((engine) =>
    engine.supportedBackends.filter((b) =>
      b.supportedServices.includes(serviceType),
    ),
  )
}

// Gets recommended backend for a service type based on OS
export function getRecommendedBackendForService(
  serviceType: Service['type'],
  os: OS,
): EngineBackend | undefined {
  const backends = getBackendsForService(serviceType)
  return (
    backends.find(
      (b) => b.recommendedOS === os && b.supportedOS.includes(os),
    ) ??
    backends.find((b) => b.supportedOS.includes(os)) ??
    backends[0]
  )
}

export function resolveEngineIdForDoc(doc: Service): string | undefined {
  if (doc.engine in engines) {
    return doc.engine
  }
  return undefined
}

export function getBackendByValue(value: string): EngineBackend | undefined {
  for (const engine of Object.values(engines)) {
    const found = engine.supportedBackends.find((b) => b.value === value)
    if (found) return found
  }
  return undefined
}
