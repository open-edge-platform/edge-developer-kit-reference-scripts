// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import type { ServiceParamGroup } from '@/types/demo-params'

interface OptionalServiceGroupOptions {
  serviceId: string
  serviceLabel: string
  offlineMessage?: string
  initialEnabled?: boolean
  optional?: boolean
}

/**
 * Builds a memoized {@link ServiceParamGroup} bound to a service's live status,
 * with an optional enable toggle. Lives under `@/hooks` (neutral) so a service's
 * feature provider can use it without importing `@/samples`
 * (see docs/OPTIONAL-SERVICES.md).
 */
export function useOptionalServiceGroup({
  serviceId,
  serviceLabel,
  offlineMessage,
  initialEnabled = true,
  optional = true,
}: OptionalServiceGroupOptions) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const online = useServiceLiveStatus(serviceId) === 'online'

  // Memoized so feature providers can publish this group through the collector
  // without re-render churn (see docs/OPTIONAL-SERVICES.md).
  const group: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel,
      serviceId,
      online,
      optional,
      offlineMessage:
        offlineMessage ??
        `Start ${serviceLabel} from the services page to enable this feature.`,
      params: [],
      ...(optional
        ? {
            enabled,
            onToggle: setEnabled,
          }
        : {}),
    }),
    [serviceLabel, serviceId, online, optional, offlineMessage, enabled],
  )

  return { enabled: optional ? online && enabled : online, online, group }
}
