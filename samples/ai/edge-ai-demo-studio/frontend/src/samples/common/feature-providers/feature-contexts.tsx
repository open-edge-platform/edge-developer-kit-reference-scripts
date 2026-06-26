// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import type { FeatureExports } from '@/context/feature-collector'
import { TtsPlaybackProvider } from '@/context/tts-playback-context'
import { VoiceInputProvider } from '@/context/voice-input-context'

/**
 * Bridges the collector's `exports` (published by the speech-to-text and
 * text-to-speech feature providers) into the React contexts that chat UI reads.
 * Wrap a sample's chat subtree with this so `conversation-panel` can pick up the
 * mic / speak controls. Both contexts are `null` when their provider is absent
 * (excluded at export), which hides the corresponding control.
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

/** Read the `sttOnline` flag published by the STT provider (false when absent). */
export function sttOnlineFromExports(exports: FeatureExports): boolean {
  return exports.sttOnline ?? false
}

/** Read the `ttsOnline` flag published by the TTS provider (false when absent). */
export function ttsOnlineFromExports(exports: FeatureExports): boolean {
  return exports.ttsOnline ?? false
}
