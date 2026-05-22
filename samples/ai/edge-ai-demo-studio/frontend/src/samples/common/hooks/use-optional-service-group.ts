// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { ServiceParamGroup } from '../components/demo-config-sheet'

interface OptionalServiceGroupOptions {
  serviceId: string
  serviceLabel: string
  offlineMessage?: string
  initialEnabled?: boolean
  optional?: boolean
}

export function useOptionalServiceGroup({
  serviceId,
  serviceLabel,
  offlineMessage,
  initialEnabled = true,
  optional = true,
}: OptionalServiceGroupOptions) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const online = useServiceLiveStatus(serviceId) === 'online'

  const group: ServiceParamGroup = {
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
  }

  return { enabled: optional ? online && enabled : online, online, group }
}
