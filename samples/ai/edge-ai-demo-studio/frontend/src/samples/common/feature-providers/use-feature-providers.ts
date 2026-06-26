// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import {
  featureProviderRegistry,
  type FeatureProviderComponent,
} from '@/services/_generated/feature-providers'

export interface ResolvedFeatureProvider {
  serviceId: string
  Provider: FeatureProviderComponent
}

/**
 * Resolve the optional-service feature providers a sample wants to mount.
 *
 * `serviceIds` is the explicit list of optional integrations the sample wires
 * (e.g. `['speech-to-text','wake-word-detection','vectordb','mcp']`) — this is
 * intentional opt-in: declaring a service as an optional dependency does NOT by
 * itself pull in its feature UI.
 *
 * A provider whose service folder was pruned at export time is simply absent
 * from the registry and drops out here with no static import — see
 * docs/OPTIONAL-SERVICES.md. Pass a stable (module-level) array.
 */
export function useFeatureProviders(
  serviceIds: string[],
): ResolvedFeatureProvider[] {
  const key = serviceIds.join('|')
  return useMemo(
    () =>
      (key ? key.split('|') : []).flatMap((serviceId) => {
        const Provider = featureProviderRegistry[serviceId]
        return Provider ? [{ serviceId, Provider }] : []
      }),
    [key],
  )
}
