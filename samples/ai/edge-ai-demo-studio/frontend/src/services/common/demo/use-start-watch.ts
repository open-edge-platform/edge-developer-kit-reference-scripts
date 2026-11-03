// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'
import { useTimeSince } from '@/hooks/use-time-since'
import { resetWork } from '@/services/common/metrics/work'
import type { Service } from '@/services/types'

/**
 * A (re)start as the demo page watches it: how long it has been starting, whether to say it is
 * ready, and the previous run's live figures cleared.
 */
export function useStartWatch({
  starting,
  startingSince,
  liveStatus,
  metricsBase,
}: {
  /** The row is starting, or a start or restart is still in flight. */
  starting: boolean
  /** When the row entered `prepare` (epoch ms). */
  startingSince: number | undefined
  liveStatus: Service['status'] | undefined
  /** The instance's API base, whose live figures a (re)start resets. */
  metricsBase: string | undefined
}) {
  // Timed from the row entering `prepare`, so leaving and returning keeps the count; 0:00 until then.
  const elapsedMs = useTimeSince(starting ? startingSince : undefined)
  const [wasStarting, setWasStarting] = useState(starting)
  // Said once, for a start watched here; never for an instance already running on page open.
  const [readyNotice, setReadyNotice] = useState(false)
  if (starting !== wasStarting) {
    setWasStarting(starting)
    if (starting) {
      setReadyNotice(false)
    } else if (liveStatus === 'online') {
      setReadyNotice(true)
    }
  }

  // A (re)start may change the model or device, so the previous run's figures no longer apply.
  useEffect(() => {
    if (starting && metricsBase) resetWork(metricsBase)
  }, [starting, metricsBase])

  return {
    elapsedMs,
    readyNotice,
    dismissReadyNotice: () => setReadyNotice(false),
  }
}
