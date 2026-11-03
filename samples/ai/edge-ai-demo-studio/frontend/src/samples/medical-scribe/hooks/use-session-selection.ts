// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect } from 'react'
import { useUrlSearchState } from '@/hooks/use-url-search-state'
import type { Session } from '../lib/types'

/**
 * The session shown, kept in `?session=<id>` so a refresh keeps it: the one named there, else the
 * newest. `null` until the sessions have loaded.
 */
export function useSessionSelection(sessions: Session[], isFetched: boolean) {
  const [params, setParams] = useUrlSearchState()
  const requested = params.get('session')
  const selectedSessionId = isFetched
    ? (sessions.find((s) => s.id === requested)?.id ?? sessions[0]?.id ?? null)
    : null

  // An address naming a session that is gone is corrected to the one shown.
  useEffect(() => {
    if (!requested || !selectedSessionId || requested === selectedSessionId)
      return
    setParams({ session: selectedSessionId })
  }, [requested, selectedSessionId, setParams])

  return {
    selectedSessionId,
    selectSession: (id: string) => setParams({ session: id }),
  }
}
