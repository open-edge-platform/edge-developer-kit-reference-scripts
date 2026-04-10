// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useSttRecording } from './use-stt-recording'
import { useWakeWordTrigger } from './use-wake-word-trigger'

/**
 * Combines wake-word detection with STT recording. When a wake word is
 * detected, microphone recording starts automatically. The transcribed
 * text is passed to `onTranscription`.
 *
 * Returns the STT recording controls and the wake-word service param group
 * for the config sheet.
 */
export function useWakeWordStt({
  onTranscription,
}: {
  onTranscription: (text: string) => void
}) {
  const stt = useSttRecording({ onTranscription })

  const wakeWord = useWakeWordTrigger({
    onWakeWord: useCallback(() => {
      if (!stt.isRecording) stt.startRecording()
    }, [stt]),
  })

  return { stt, wakeWord }
}
