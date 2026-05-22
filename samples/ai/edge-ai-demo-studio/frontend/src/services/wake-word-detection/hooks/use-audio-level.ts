// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from '@tanstack/react-query'

const API_BASE = '/api/wake-word-detection'

interface AudioLevel {
  level: number
  active: boolean
}

/**
 * Polls the worker's audio level endpoint to get real-time
 * RMS microphone input level (0.0–1.0).
 * Only polls while detection is active.
 */
export function useAudioLevel(enabled: boolean) {
  const query = useQuery<AudioLevel>({
    queryKey: ['wake-word-detection', 'audio-level'],
    enabled,
    refetchInterval: enabled ? 150 : false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/wake-word-detection/audio-level`)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  return {
    level: query.data?.level ?? 0,
    active: query.data?.active ?? false,
  }
}
