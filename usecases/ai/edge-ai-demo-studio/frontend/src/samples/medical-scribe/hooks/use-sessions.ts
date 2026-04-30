// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '../types'
import { parseResponse } from '../utils'

const QUERY_KEY = ['medical-scribe', 'sessions'] as const
const API_BASE = '/api/medical-scribe-database/v1/sessions'

function sanitizeSessionUpdate(updates: Partial<Omit<Session, 'id'>>) {
  const { audioBlob: _audioBlob, ...rest } = updates
  return rest
}

export function useSessions() {
  const queryClient = useQueryClient()

  const sessionsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}`)
      return parseResponse<Session[]>(res, 'Failed to load sessions')
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: async (session: Session) => {
      const res = await fetch(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: session.id,
          name: session.name,
          doctorProfileId: session.doctorProfileId,
          language: session.language,
        }),
      })
      return parseResponse<Session>(res, 'Failed to create session')
    },
  })

  const updateSessionMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<Session, 'id'>>
    }) => {
      const res = await fetch(new URL(`${API_BASE}/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizeSessionUpdate(updates)),
      })
      return parseResponse<Session>(res, 'Failed to update session')
    },
  })

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(new URL(`${API_BASE}/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to delete session')
      }
    },
  })

  const sessions = sessionsQuery.data ?? []
  const isLoading = sessionsQuery.isLoading
  const isFetched = sessionsQuery.isFetched

  const createSession = useCallback(
    (name: string, doctorProfileId: string | null, language: string) => {
      const session: Session = {
        id: crypto.randomUUID(),
        name,
        doctorProfileId,
        language,
        status: 'idle',
        transcripts: [],
        soapReport: null,
        audioBlob: null,
      }

      queryClient.setQueryData<Session[]>(QUERY_KEY, (prev = []) => [
        session,
        ...prev,
      ])

      void createSessionMutation.mutateAsync(session).catch(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })

      return session
    },
    [createSessionMutation, queryClient],
  )

  const updateSession = useCallback(
    (id: string, updates: Partial<Omit<Session, 'id'>>) => {
      queryClient.setQueryData<Session[]>(QUERY_KEY, (prev = []) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      )

      void updateSessionMutation.mutateAsync({ id, updates }).catch(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })
    },
    [queryClient, updateSessionMutation],
  )

  const deleteSession = useCallback(
    (id: string) => {
      queryClient.setQueryData<Session[]>(QUERY_KEY, (prev = []) =>
        prev.filter((s) => s.id !== id),
      )

      void deleteSessionMutation.mutateAsync(id).catch(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })
    },
    [deleteSessionMutation, queryClient],
  )

  return {
    sessions,
    isLoading,
    isFetched,
    createSession,
    updateSession,
    deleteSession,
  }
}
