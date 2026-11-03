// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * TTS playback controls shared between the TTS feature provider and chat UI (the speak button).
 * Lives outside the optional text-to-speech folder so required services can read it; without TTS
 * the value stays `null` and the speak button hides (docs/OPTIONAL-SERVICES.md).
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
