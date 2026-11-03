// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/browser/fetch-json'
import { useTtsModel } from './use-synthesize-speech'

/**
 * Normalises `GET /v1/audio/voices`: built-in workers answer `{ voiceId: downloaded }`; OEP answers
 * model info whose `supported_speakers` are bundled (always available) and matched
 * case-insensitively upstream, so they are added as sent and lowercased.
 */
function toVoiceMap(payload: unknown): Record<string, boolean> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.supported_speakers)) {
    const map: Record<string, boolean> = {}
    for (const speaker of record.supported_speakers) {
      if (typeof speaker !== 'string') continue
      map[speaker] = true
      map[speaker.toLowerCase()] = true
    }
    return map
  }
  const map: Record<string, boolean> = {}
  for (const [voice, downloaded] of Object.entries(record)) {
    if (typeof downloaded === 'boolean') map[voice] = downloaded
  }
  return map
}

interface UseTtsVoiceStatusOptions {
  /** Part of the query key, so an instance restarted with another model is asked again. */
  model?: string
  /** False pauses polling (the instance is stopped). */
  enabled?: boolean
}

/** Voices the worker at `apiBase` has downloaded; keeps the last answer while not polling. */
export function useTtsVoiceStatus(
  apiBase: string | undefined,
  options?: UseTtsVoiceStatusOptions,
) {
  const typeModel = useTtsModel()
  const model = options?.model ?? typeModel
  const queryClient = useQueryClient()
  const queryKey = ['tts-voice-status', apiBase, model]

  const { data: voiceMap } = useQuery<Record<string, boolean>>({
    queryKey,
    queryFn: async () => {
      const data = await fetchJson<unknown>(`${apiBase}/v1/audio/voices`, {
        errorMessage: 'Failed to fetch voice status',
      })
      return toVoiceMap(data)
    },
    enabled: Boolean(apiBase) && options?.enabled !== false,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  return {
    voiceMap: voiceMap ?? null,
    isVoiceDownloaded: (voiceId: string) => voiceMap?.[voiceId] === true,
    /** Marks a voice that just spoke as downloaded without waiting for the next poll. */
    markDownloaded: (voiceId: string) =>
      queryClient.setQueryData<Record<string, boolean>>(queryKey, (prev) =>
        prev ? { ...prev, [voiceId]: true } : prev,
      ),
  }
}
