// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs `process` over enqueued items one at a time, in order, always with the latest `process`, so a
 * fresh closure each render neither restarts the loop nor drops items.
 */
export function useSerialQueue<T>(process: (item: T) => Promise<void>) {
  const queueRef = useRef<T[]>([])
  const isProcessingRef = useRef(false)
  // A ref rather than `useEffectEvent`: the drain loop calls it from
  // promise callbacks, and effect events may only be called from effects.
  const processRef = useRef(process)
  useEffect(() => {
    processRef.current = process
  }, [process])

  const runNext = () => {
    const next = queueRef.current.shift()
    if (next === undefined) {
      isProcessingRef.current = false
      return
    }
    try {
      processRef
        .current(next)
        .catch(() => {})
        .finally(runNext)
    } catch {
      isProcessingRef.current = false
    }
  }

  const enqueue = (item: T) => {
    queueRef.current.push(item)
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    runNext()
  }

  return { enqueue }
}
