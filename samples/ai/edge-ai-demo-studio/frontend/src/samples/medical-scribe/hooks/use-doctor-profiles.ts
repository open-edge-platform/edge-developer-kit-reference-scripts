// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import type { DoctorProfile } from '../lib/types'
import { useOptimisticSessionMutation } from './use-optimistic-session-mutation'

const doctorProfilesKey = (apiBase: string | undefined) =>
  ['medical-scribe', 'doctor-profiles', apiBase] as const

const SERVICE_NAME = 'Medical Scribe Database'

export function useDoctorProfiles(apiBase: string | undefined) {
  const queryKey = doctorProfilesKey(apiBase)

  const profilesQuery = useQuery({
    queryKey,
    enabled: Boolean(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson<DoctorProfile[]>(`${apiBase}/v1/doctor-profiles`, {
        errorMessage: 'Failed to load doctor profiles',
      })
    },
  })

  const { mutate: createProfileMutate } = useOptimisticSessionMutation<
    DoctorProfile,
    DoctorProfile,
    DoctorProfile
  >({
    queryKey,
    mutationFn: (profile) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<DoctorProfile>(
        `${apiBase}/v1/doctor-profiles`,
        { id: profile.id, name: profile.name },
        { errorMessage: 'Failed to create doctor profile' },
      )
    },
    patch: (prev, profile) => [...prev, profile],
  })

  const { mutate: deleteProfileMutate } = useOptimisticSessionMutation<
    DoctorProfile,
    string,
    void
  >({
    queryKey,
    mutationFn: (id) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson<void>(`${apiBase}/v1/doctor-profiles/${id}`, {
        method: 'DELETE',
        errorMessage: 'Failed to delete doctor profile',
      })
    },
    patch: (prev, id) => prev.filter((p) => p.id !== id),
  })

  const { mutate: updateEmbeddingMutate } = useOptimisticSessionMutation<
    DoctorProfile,
    { id: string; embedding: number[] },
    DoctorProfile
  >({
    queryKey,
    mutationFn: ({ id, embedding }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<DoctorProfile>(
        `${apiBase}/v1/doctor-profiles/${id}`,
        { embedding },
        { method: 'PATCH', errorMessage: 'Failed to update embedding' },
      )
    },
    patch: (prev, { id, embedding }) =>
      prev.map((p) => (p.id === id ? { ...p, embedding } : p)),
  })

  const addProfile = (name: string): DoctorProfile => {
    const profile: DoctorProfile = {
      id: crypto.randomUUID(),
      name,
      embedding: null,
    }
    createProfileMutate(profile)
    return profile
  }

  return {
    profiles: profilesQuery.data ?? [],
    addProfile,
    removeProfile: (id: string) => deleteProfileMutate(id),
    updateEmbedding: (id: string, embedding: number[]) =>
      updateEmbeddingMutate({ id, embedding }),
  }
}
