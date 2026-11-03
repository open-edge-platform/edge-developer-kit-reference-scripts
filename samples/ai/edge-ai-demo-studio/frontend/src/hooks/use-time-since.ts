// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'

/** Ms from `since` (epoch ms) to now, ticking every `tickMs`; 0 when unset. Survives a remount. */
export function useTimeSince(since: number | undefined, tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (since === undefined) return
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, tickMs)
    return () => clearInterval(id)
  }, [since, tickMs])

  // `now` may predate a just-set `since` (or clocks may skew): never show a negative time.
  return since === undefined ? 0 : Math.max(0, now - since)
}
