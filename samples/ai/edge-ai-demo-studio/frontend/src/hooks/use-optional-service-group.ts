// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import type { DemoParam, ServiceParamGroup } from '@/types/demo-params'

interface OptionalServiceGroupOptions {
  serviceId: string
  serviceLabel: string
  offlineMessage?: string
  /** Where the offline notice sends the user to set the service up. */
  configHref?: string
  initialEnabled?: boolean
  optional?: boolean
  params?: DemoParam[]
}

/**
 * A memoized {@link ServiceParamGroup} bound to a service's live status, with an optional enable
 * toggle. In `@/hooks` so service feature providers need not import `@/samples`.
 */
export function useOptionalServiceGroup({
  serviceId,
  serviceLabel,
  offlineMessage,
  configHref,
  initialEnabled = true,
  optional = true,
  params,
}: OptionalServiceGroupOptions) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const online = useServiceLiveStatus(serviceId) === 'online'

  // Memoized so feature providers can publish it through the collector without re-render churn.
  const group: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel,
      serviceId,
      online,
      optional,
      offlineMessage:
        offlineMessage ??
        `Start ${serviceLabel} from the services page to enable this feature.`,
      ...(configHref ? { configHref } : {}),
      params: params ?? [],
      ...(optional
        ? {
            enabled,
            onToggle: setEnabled,
          }
        : {}),
    }),
    [
      serviceLabel,
      serviceId,
      online,
      optional,
      offlineMessage,
      configHref,
      enabled,
      params,
    ],
  )

  return { enabled: optional ? online && enabled : online, online, group }
}
