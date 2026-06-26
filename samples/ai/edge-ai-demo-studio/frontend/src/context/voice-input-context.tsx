// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Voice-input (speech-to-text) recording controls shared between the
 * speech-to-text feature provider (which owns the recording state) and chat UI
 * such as `conversation-panel`.
 *
 * This contract lives in neutral shared infra — NOT in the speech-to-text
 * folder — so a required-service component (conversation-panel lives in the
 * text-generation folder) can read it without statically importing the optional
 * speech-to-text folder. When STT is excluded at export time its provider is
 * never mounted, the context value stays `null`, and the mic UI simply hides.
 * See docs/OPTIONAL-SERVICES.md.
 */
export interface VoiceInputControls {
  isRecording: boolean
  isPending: boolean
  micError: string | null
  startRecording: () => void
  stopRecording: () => void
}

const VoiceInputContext = createContext<VoiceInputControls | null>(null)

export function VoiceInputProvider({
  value,
  children,
}: {
  value: VoiceInputControls | null
  children: ReactNode
}) {
  return (
    <VoiceInputContext.Provider value={value}>
      {children}
    </VoiceInputContext.Provider>
  )
}

/** Voice-input controls, or `null` when no STT provider is mounted. */
export function useVoiceInput(): VoiceInputControls | null {
  return useContext(VoiceInputContext)
}
