// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * STT recording controls shared between the STT feature provider and chat UI (the mic button).
 * Lives outside the optional speech-to-text folder so required services can read it; without STT
 * the value stays `null` and the mic UI hides (docs/OPTIONAL-SERVICES.md).
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
