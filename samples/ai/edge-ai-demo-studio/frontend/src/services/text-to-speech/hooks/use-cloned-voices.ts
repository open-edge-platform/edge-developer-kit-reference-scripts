// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson } from '@/lib/browser/fetch-json'

export interface AddVoiceRequest {
  name: string
  recording: Blob
  /** What the recording says; empty clones the voice cross-lingually. */
  transcript: string
}

interface AddVoiceResponse {
  voice: string
  transcript: boolean
  seconds: number
}

/** Clones and removes voices on a cloning worker; either refreshes its voice list. */
export function useClonedVoices(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['tts-voice-status', apiBase] })

  const add = useMutation({
    mutationFn: ({ name, recording, transcript }: AddVoiceRequest) => {
      requireApiBase(apiBase, 'Text to Speech')
      const form = new FormData()
      form.append('name', name)
      form.append(
        'file',
        recording,
        recording instanceof File ? recording.name : 'recording.webm',
      )
      if (transcript.trim()) form.append('transcript', transcript.trim())
      return fetchJson<AddVoiceResponse>(`${apiBase}/v1/audio/voices`, {
        method: 'POST',
        body: form,
        errorMessage: 'Adding the voice failed',
      })
    },
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (name: string) => {
      requireApiBase(apiBase, 'Text to Speech')
      return fetchJson(
        `${apiBase}/v1/audio/voices/${encodeURIComponent(name)}`,
        { method: 'DELETE', errorMessage: 'Removing the voice failed' },
      )
    },
    onSuccess: refresh,
  })

  return { add, remove }
}
