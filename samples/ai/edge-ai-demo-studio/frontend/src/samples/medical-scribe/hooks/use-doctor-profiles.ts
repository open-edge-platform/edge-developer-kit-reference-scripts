// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DoctorProfile } from '../types'
import { parseResponse } from '../utils'

const QUERY_KEY = ['medical-scribe', 'doctor-profiles'] as const
const API_BASE = '/api/medical-scribe-database/v1/doctor-profiles'

export function useDoctorProfiles() {
  const queryClient = useQueryClient()

  const profilesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}`)
      return parseResponse<DoctorProfile[]>(
        res,
        'Failed to load doctor profiles',
      )
    },
  })

  const createProfileMutation = useMutation({
    mutationFn: async (profile: DoctorProfile) => {
      const res = await fetch(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: profile.id, name: profile.name }),
      })
      return parseResponse<DoctorProfile>(
        res,
        'Failed to create doctor profile',
      )
    },
  })

  const deleteProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        new URL(`${API_BASE}/${id}`, window.location.origin),
        {
          method: 'DELETE',
        },
      )
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to delete doctor profile')
      }
    },
  })

  const updateEmbeddingMutation = useMutation({
    mutationFn: async ({
      id,
      embedding,
    }: {
      id: string
      embedding: number[]
    }) => {
      const res = await fetch(
        new URL(`${API_BASE}/${id}`, window.location.origin),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embedding }),
        },
      )
      return parseResponse<DoctorProfile>(res, 'Failed to update embedding')
    },
  })

  const profiles = profilesQuery.data ?? []

  const addProfile = useCallback(
    (name: string) => {
      const profile: DoctorProfile = {
        id: crypto.randomUUID(),
        name,
        embedding: null,
      }

      queryClient.setQueryData<DoctorProfile[]>(QUERY_KEY, (prev = []) => [
        ...prev,
        profile,
      ])

      createProfileMutation.mutateAsync(profile).catch(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })

      return profile
    },
    [createProfileMutation, queryClient],
  )

  const removeProfile = useCallback(
    (id: string) => {
      queryClient.setQueryData<DoctorProfile[]>(QUERY_KEY, (prev = []) =>
        prev.filter((p) => p.id !== id),
      )

      deleteProfileMutation.mutateAsync(id).catch(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })
    },
    [deleteProfileMutation, queryClient],
  )

  const updateEmbedding = useCallback(
    (id: string, embedding: number[]) => {
      queryClient.setQueryData<DoctorProfile[]>(QUERY_KEY, (prev = []) =>
        prev.map((p) => (p.id === id ? { ...p, embedding } : p)),
      )

      updateEmbeddingMutation.mutateAsync({ id, embedding }).catch(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      })
    },
    [queryClient, updateEmbeddingMutation],
  )

  return { profiles, addProfile, removeProfile, updateEmbedding }
}
