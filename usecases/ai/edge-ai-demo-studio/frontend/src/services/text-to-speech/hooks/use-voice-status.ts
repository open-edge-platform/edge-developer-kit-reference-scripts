// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { KOKORO_LANGUAGES, KOKORO_VOICES } from '../config'

/** Per-language download status derived from individual voice files. */
export interface LanguageDownloadStatus {
  code: string
  label: string
  downloaded: number
  total: number
}

/**
 * Fetches voice download status from the TTS worker and derives
 * per-language download information.
 *
 * Only polls while the TTS service is online.
 */
export function useTtsVoiceStatus() {
  const ttsStatus = useServiceLiveStatus('text-to-speech')
  const isOnline = ttsStatus === 'online'

  const { data: voiceMap } = useQuery<Record<string, boolean>>({
    queryKey: ['tts-voice-status'],
    queryFn: async () => {
      const res = await fetch('/api/text-to-speech/v1/audio/voices')
      if (!res.ok) throw new Error('Failed to fetch voice status')
      return res.json()
    },
    enabled: isOnline,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  if (!voiceMap) {
    return { voiceMap: null, languages: null, isVoiceDownloaded: () => false }
  }

  const languages: LanguageDownloadStatus[] = KOKORO_LANGUAGES.map((lang) => {
    const langVoices = KOKORO_VOICES.filter((v) => v.language === lang.label)
    const downloaded = langVoices.filter((v) => voiceMap[v.id] === true).length
    return {
      code: lang.code,
      label: lang.label,
      downloaded,
      total: langVoices.length,
    }
  })

  const isVoiceDownloaded = (voiceId: string) => voiceMap[voiceId] === true

  return { voiceMap, languages, isVoiceDownloaded }
}
