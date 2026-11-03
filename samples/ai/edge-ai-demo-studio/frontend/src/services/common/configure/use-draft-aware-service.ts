// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import type { Service } from '@/services/types'

/**
 * The service view a Configure panel renders from: under a New-instance draft, `service` on the
 * draft's engine, since the draft's `EngineTabs` writes to the draft host, not the row.
 */
export function useDraftAwareService(service: Service): Service {
  const draftHost = useConfigureDraftHost()
  if (!draftHost) return service
  return { ...service, engine: draftHost.engine as Service['engine'] }
}
