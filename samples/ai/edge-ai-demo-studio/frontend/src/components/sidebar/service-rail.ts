// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getAttentionStatus } from '@/lib/instances/service-presentation'
import type { Service } from '@/services/types'
import { isRunningStatus } from '@/services/types'
import { hasExecutionMode } from '@/services/execution'

/** Active: running, starting or failed. */
function isServiceActive(service: Service): boolean {
  const status = getAttentionStatus(service)
  return isRunningStatus(status) || status === 'error'
}

/**
 * Whether the sidebar rail lists a service: every added service plus anything active. Services with
 * execution mode `none` run inside the studio and are never added: listed while in `inUse`.
 */
export function isServiceInSidebar(
  service: Service,
  inUse: readonly string[],
): boolean {
  if (hasExecutionMode(service.execution, 'none')) {
    return inUse.includes(service.id)
  }
  return Boolean(service.added) || isServiceActive(service)
}
