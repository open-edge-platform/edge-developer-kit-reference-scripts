// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'

export interface UseElapsedMsOptions {
  /** Tick interval, in ms. Also the increment applied per tick. Default 1000. */
  tickMs?: number
}

/** Elapsed ms of the current run: reset when `running` turns true, kept after it stops. */
export function useElapsedMs(
  running: boolean,
  opts: UseElapsedMsOptions = {},
): number {
  const { tickMs = 1000 } = opts
  const [elapsedMs, setElapsedMs] = useState(0)
  const [wasRunning, setWasRunning] = useState(running)

  // Reset on start by adjusting state during render rather than in an effect.
  if (running !== wasRunning) {
    setWasRunning(running)
    if (running) setElapsedMs(0)
  }

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setElapsedMs((prev) => prev + tickMs)
    }, tickMs)
    return () => clearInterval(id)
  }, [running, tickMs])

  return elapsedMs
}
