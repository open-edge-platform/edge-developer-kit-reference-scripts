// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSynthesizeSpeech } from './use-synthesize-speech'

interface UseTtsPlaybackOptions {
  voice?: string
  speed?: number
}

export function useTtsPlayback({
  voice = 'af_heart',
  speed = 1.0,
}: UseTtsPlaybackOptions = {}) {
  const { mutate: synthesize } = useSynthesizeSpeech()
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null)

  const handleSpeak = useCallback(
    (text: string, msgId: string) => {
      // Stop current playback
      if (audioElRef.current) {
        audioElRef.current.pause()
        URL.revokeObjectURL(audioElRef.current.src)
        audioElRef.current = null
      }
      if (speakingMsgId === msgId) {
        setSpeakingMsgId(null)
        return
      }

      setSpeakingMsgId(msgId)
      synthesize(
        {
          input: text,
          voice,
          speed,
          responseFormat: 'mp3',
        },
        {
          onSuccess: (blob) => {
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audioElRef.current = audio
            audio.onended = () => {
              URL.revokeObjectURL(url)
              audioElRef.current = null
              setSpeakingMsgId(null)
            }
            audio.play()
          },
          onError: () => {
            setSpeakingMsgId(null)
          },
        },
      )
    },
    [synthesize, voice, speed, speakingMsgId],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioElRef.current) {
        audioElRef.current.pause()
        URL.revokeObjectURL(audioElRef.current.src)
      }
    }
  }, [])

  return {
    speakingMsgId,
    handleSpeak,
  }
}
