// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { timestampNow } from '../lib/timestamps'
import type { Session, SessionUpdate } from '../lib/types'
import { useOptimisticSessionMutation } from './use-optimistic-session-mutation'

const SERVICE_NAME = 'Medical Scribe Database'

const sessionsKey = (apiBase: string | undefined) =>
  ['medical-scribe', 'sessions', apiBase] as const

export function useSessions(apiBase: string | undefined) {
  const queryKey = sessionsKey(apiBase)

  const sessionsQuery = useQuery({
    queryKey,
    enabled: Boolean(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson<Session[]>(`${apiBase}/v1/sessions`, {
        errorMessage: 'Failed to load sessions',
      })
    },
  })

  const { mutate: createSessionMutate } = useOptimisticSessionMutation<
    Session,
    Session,
    Session
  >({
    queryKey,
    mutationFn: (session) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<Session>(
        `${apiBase}/v1/sessions`,
        {
          id: session.id,
          name: session.name,
          doctorProfileId: session.doctorProfileId,
          language: session.language,
          sessionCreatedAt: session.sessionCreatedAt,
        },
        { errorMessage: 'Failed to create session' },
      )
    },
    patch: (prev, session) => [session, ...prev],
    onSuccess: (serverSession, _session, prev) =>
      prev.map((s) =>
        s.id === serverSession.id ? { ...s, ...serverSession } : s,
      ),
  })

  const { mutate: updateSessionMutate } = useOptimisticSessionMutation<
    Session,
    { id: string; updates: SessionUpdate },
    Session
  >({
    queryKey,
    mutationFn: ({ id, updates }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<Session>(`${apiBase}/v1/sessions/${id}`, updates, {
        method: 'PATCH',
        errorMessage: 'Failed to update session',
      })
    },
    patch: (prev, { id, updates }) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
  })

  const { mutate: deleteSessionMutate } = useOptimisticSessionMutation<
    Session,
    string,
    void
  >({
    queryKey,
    mutationFn: (id) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson<void>(`${apiBase}/v1/sessions/${id}`, {
        method: 'DELETE',
        errorMessage: 'Failed to delete session',
      })
    },
    patch: (prev, id) => prev.filter((s) => s.id !== id),
  })

  const createSession = (
    name: string,
    doctorProfileId: string | null,
    language: string,
  ): Session => {
    const session: Session = {
      id: crypto.randomUUID(),
      name,
      doctorProfileId,
      doctorProfileName: null,
      language,
      sessionCreatedAt: timestampNow(),
      dialogueCreatedAt: null,
      reportCreatedAt: null,
      status: 'idle',
      transcripts: [],
      soapReport: null,
    }
    createSessionMutate(session)
    return session
  }

  return {
    sessions: sessionsQuery.data ?? [],
    isLoading: sessionsQuery.isLoading,
    isFetched: sessionsQuery.isFetched,
    createSession,
    updateSession: (id: string, updates: SessionUpdate) =>
      updateSessionMutate({ id, updates }),
    deleteSession: (id: string) => deleteSessionMutate(id),
  }
}
