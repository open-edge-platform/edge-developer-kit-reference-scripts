// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useSttRecording } from '@/services/common/hooks/use-stt-recording'
import { useWakeWordTrigger } from './use-wake-word-trigger'

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
