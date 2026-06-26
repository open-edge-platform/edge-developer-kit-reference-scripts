// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Text-to-speech playback controls shared between the text-to-speech feature
 * provider (which owns playback state) and chat UI such as `conversation-panel`
 * (the per-message speak button).
 *
 * Lives in neutral shared infra — NOT in the text-to-speech folder — so the
 * required-service `conversation-panel` (in the text-generation folder) can read
 * it without statically importing the optional text-to-speech folder. When TTS
 * is excluded at export time its provider never mounts, the value stays `null`,
 * and the speak button hides. See docs/OPTIONAL-SERVICES.md.
 */
export interface TtsPlaybackControls {
  speakingMsgId: string | null
  handleSpeak: (text: string, msgId: string) => void
}

const TtsPlaybackContext = createContext<TtsPlaybackControls | null>(null)

export function TtsPlaybackProvider({
  value,
  children,
}: {
  value: TtsPlaybackControls | null
  children: ReactNode
}) {
  return (
    <TtsPlaybackContext.Provider value={value}>
      {children}
    </TtsPlaybackContext.Provider>
  )
}

/** TTS playback controls, or `null` when no TTS provider is mounted. */
export function useTtsPlaybackControls(): TtsPlaybackControls | null {
  return useContext(TtsPlaybackContext)
}
