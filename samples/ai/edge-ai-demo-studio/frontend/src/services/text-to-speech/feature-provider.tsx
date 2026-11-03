// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import {
  useFeaturePublish,
  useSingletonGroup,
} from '@/context/feature-collector'
import type { TtsPlaybackControls } from '@/context/tts-playback-context'
import { useTtsParams } from './hooks/use-tts-params'
import { useTtsPlayback } from './hooks/use-tts-playback'

/** Headless provider for optional TTS: publishes its group, `ttsPlayback` and `ttsOnline`. */
export function TtsFeatureProvider({ sampleId }: { sampleId?: string }) {
  const tts = useTtsParams(sampleId ?? '')
  const playback = useTtsPlayback({
    voice: tts.values.voice,
    speed: tts.values.speed,
  })

  const groups = useSingletonGroup(tts.group)

  // Kept stable: the collector re-registers the provider whenever `exports` changes identity.
  const ttsPlayback: TtsPlaybackControls = useMemo(
    () => ({
      speakingMsgId: playback.speakingMsgId,
      handleSpeak: playback.handleSpeak,
    }),
    [playback.speakingMsgId, playback.handleSpeak],
  )

  const exports = useMemo(
    () => ({ ttsPlayback, ttsOnline: tts.online }),
    [ttsPlayback, tts.online],
  )

  useFeaturePublish('text-to-speech', { groups, exports })

  return null
}
