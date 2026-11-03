// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import type { FeatureExports } from '@/context/feature-collector'
import { TtsPlaybackProvider } from '@/context/tts-playback-context'
import { VoiceInputProvider } from '@/context/voice-input-context'

/**
 * Bridges the feature collector's `exports` into the voice-input and TTS-playback contexts the
 * chat reads; a context is `null`, hiding its control, when its provider is absent.
 * See docs/OPTIONAL-SERVICES.md.
 */
export function FeatureContexts({
  exports,
  children,
}: {
  exports: FeatureExports
  children: ReactNode
}) {
  return (
    <VoiceInputProvider value={exports.voiceInput ?? null}>
      <TtsPlaybackProvider value={exports.ttsPlayback ?? null}>
        {children}
      </TtsPlaybackProvider>
    </VoiceInputProvider>
  )
}
