// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Service } from '@/services/types'

/** Which notice stands in for (or above) the demo; `null` for none. */
export type DemoNoticeKind =
  'stopping' | 'starting' | 'error' | 'stopped' | 'prerequisites' | null

export function demoNoticeKind({
  isOffline,
  stoppingKeptDemo,
  pendingAction,
  starting,
  liveStatus,
  waitingForPrerequisites,
}: {
  isOffline: boolean
  /** A kept demo is on screen while its instance stops. */
  stoppingKeptDemo: boolean
  pendingAction: string | null
  /** Starting or restarting, or a start or restart still in flight. */
  starting: boolean
  liveStatus: Service['status'] | undefined
  waitingForPrerequisites: boolean
}): DemoNoticeKind {
  if (pendingAction === 'stop' && (isOffline || stoppingKeptDemo)) {
    return 'stopping'
  }
  // Also a restart asked for here while the row still reads running.
  if (starting) return 'starting'
  if (isOffline) return liveStatus === 'error' ? 'error' : 'stopped'
  return waitingForPrerequisites ? 'prerequisites' : null
}
