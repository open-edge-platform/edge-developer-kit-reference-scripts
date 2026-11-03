// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { plural } from '@/lib/browser/format'
import type { Session, SessionUpdate } from '../lib/types'

const INTERRUPTED =
  'Processing was interrupted by a page reload. Please record or upload again.'

/** On first load, marks sessions a previous page left recording or processing as failed. */
export function useInterruptedSessionRecovery({
  sessions,
  isFetched,
  updateSession,
}: {
  sessions: Session[]
  isFetched: boolean
  updateSession: (id: string, updates: SessionUpdate) => void
}) {
  const reconciledRef = useRef(false)
  useEffect(() => {
    if (!isFetched || reconciledRef.current) return
    reconciledRef.current = true
    const interrupted = sessions.filter(
      (s) => s.status === 'processing' || s.status === 'recording',
    )
    if (interrupted.length === 0) return
    for (const session of interrupted) {
      updateSession(session.id, { status: 'error', errorMessage: INTERRUPTED })
    }
    toast.error(
      interrupted.length === 1
        ? INTERRUPTED
        : `${plural(interrupted.length, 'session')} were interrupted by a page reload. Please record or upload them again.`,
    )
  }, [isFetched, sessions, updateSession])
}
