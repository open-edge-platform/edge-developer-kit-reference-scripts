// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { recordWork } from '@/services/common/metrics/work'
import type { Service } from '@/services/types'
import { LiveSession, type LiveStartOptions } from '../lib/live/live-session'

/**
 * Streams live mic PCM to the STT worker, one `LiveSession` at a time. `start` rejects when the mic
 * or socket can't open, or with a cancellation if `stop` came first; `stop` resolves once the final
 * utterance is flushed. `stream` is the mic stream for a visualizer. Unmounting ends every session.
 */
export function useLiveStream(service: Service | undefined) {
  const sessionRef = useRef<LiveSession | null>(null)
  // Sessions `stop` ended that are still flushing their last utterance.
  const flushingRef = useRef(new Set<LiveSession>())
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    const flushing = flushingRef.current
    return () => {
      sessionRef.current?.dispose()
      sessionRef.current = null
      for (const session of flushing) session.dispose()
      flushing.clear()
    }
  }, [])

  const start = (options: LiveStartOptions): Promise<void> => {
    sessionRef.current?.dispose()
    const apiBase = service?.apiBase
    const session: LiveSession = new LiveSession(options, {
      port: service?.instancePort,
      measured: ({ audioSeconds, ...times }) =>
        recordWork(apiBase, { ...times, quantities: { audioSeconds } }),
      onCapture: (captured) => {
        if (sessionRef.current === session) setStream(captured)
      },
    })
    sessionRef.current = session
    return session.open()
  }

  const stop = (): Promise<void> => {
    const session = sessionRef.current
    sessionRef.current = null
    setStream(null)
    if (!session) return Promise.resolve()
    const flushing = flushingRef.current
    flushing.add(session)
    return session.stop().finally(() => flushing.delete(session))
  }

  return { start, stop, stream }
}
