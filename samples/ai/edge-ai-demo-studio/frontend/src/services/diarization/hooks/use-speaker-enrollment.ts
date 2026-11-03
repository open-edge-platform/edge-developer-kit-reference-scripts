// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useExternalStore } from '@/hooks/use-external-store'
import { createExternalStore } from '@/lib/browser/external-store'
import { getErrorMessage } from '@/lib/errors'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionResource } from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import {
  createSpeaker,
  type EnrolledSpeaker,
  nextSpeakerIndex,
} from '../lib/speakers'
import { type SpeakerProfile, useEnrollSpeaker } from './index'

const NO_SPEAKERS: EnrolledSpeaker[] = []

/**
 * The speakers enrolled for a diarization run, each from a voice sample embedded on the worker.
 * Kept per instance for the page visit, so an enrolment still running settles after a switch.
 */
export function useSpeakerEnrollment(service: Service) {
  const roster = useSessionResource(
    demoStateKey(service, 'diarization:speakers'),
    () => createExternalStore<EnrolledSpeaker[]>(NO_SPEAKERS),
    () => {},
  )
  const speakers = useExternalStore(roster)
  const setSpeakers = roster.set
  const { mutateAsync: enrollSpeaker } = useEnrollSpeaker(service.apiBase)

  const updateSpeaker = (id: string, patch: Partial<EnrolledSpeaker>) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    )
  }

  /** Applies an enrolment's outcome, unless its sample was swapped meanwhile. */
  const settleEnrollment = (
    id: string,
    file: File,
    patch: Partial<EnrolledSpeaker>,
  ) => {
    setSpeakers((prev) =>
      prev.map((s) =>
        s.id === id && s.file === file ? { ...s, ...patch } : s,
      ),
    )
  }

  const addSpeaker = () => {
    setSpeakers((prev) => [...prev, createSpeaker(nextSpeakerIndex(prev))])
  }

  const removeSpeaker = (id: string) => {
    setSpeakers((prev) => prev.filter((s) => s.id !== id))
  }

  const renameSpeaker = (id: string, label: string) =>
    updateSpeaker(id, { label })

  const setSample = (speaker: EnrolledSpeaker, file: File | null) => {
    if (!file) {
      updateSpeaker(speaker.id, {
        file: null,
        embedding: null,
        status: 'idle',
        error: undefined,
      })
      return
    }

    updateSpeaker(speaker.id, { file, status: 'enrolling', error: undefined })
    // Each enrolment settles its own speaker: concurrent calls share the mutation, whose per-call
    // callbacks fire only for the latest call.
    enrollSpeaker(file).then(
      (data) =>
        settleEnrollment(speaker.id, file, {
          embedding: data.embedding,
          status: 'enrolled',
        }),
      (error: unknown) =>
        settleEnrollment(speaker.id, file, {
          status: 'error',
          error: getErrorMessage(error, 'Speaker enrollment failed'),
        }),
    )
  }

  const profiles: SpeakerProfile[] = speakers
    .filter(
      (s): s is EnrolledSpeaker & { embedding: number[] } =>
        s.status === 'enrolled' && s.embedding !== null,
    )
    .map((s) => ({ label: s.label, embedding: s.embedding }))

  return {
    speakers,
    profiles,
    enrolledCount: profiles.length,
    isAnyEnrolling: speakers.some((s) => s.status === 'enrolling'),
    addSpeaker,
    removeSpeaker,
    renameSpeaker,
    setSample,
  }
}
