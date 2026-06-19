// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSentenceSpeech } from '@/samples/common/hooks/use-sentence-speech'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { useSynthesizeSpeech } from '@/services/text-to-speech/hooks/use-synthesize-speech'

interface UseAvatarSpeechQueueOptions {
  messages: ChatMsg[]
  status: ChatStatus
  enabled: boolean
  voice: string
  speed: number
  onStopStream: () => void
  onAvatarStateChange: (state: 'idle' | 'talking') => void
}

export function useAvatarSpeechQueue({
  messages,
  status,
  enabled,
  voice,
  speed,
  onStopStream,
  onAvatarStateChange,
}: UseAvatarSpeechQueueOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const synthesizeSpeech = useSynthesizeSpeech()
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const processNextRef = useRef<() => void>(() => {})

  const clearCurrentAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current = null
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current)
      currentUrlRef.current = null
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    isPlayingRef.current = false
    setIsSpeaking(false)
    onAvatarStateChange('idle')
  }, [onAvatarStateChange])

  useEffect(() => {
    processNextRef.current = () => {
      const nextSentence = audioQueueRef.current.shift()
      if (!nextSentence) {
        stopSpeaking()
        return
      }

      synthesizeSpeech.mutate(
        {
          input: nextSentence,
          voice,
          speed,
          responseFormat: 'mp3',
        },
        {
          onSuccess: (blob) => {
            const url = URL.createObjectURL(blob)
            currentUrlRef.current = url
            const audio = new Audio(url)
            audioRef.current = audio

            let handled = false
            const cleanup = () => {
              if (handled) return
              handled = true
              URL.revokeObjectURL(url)
              currentUrlRef.current = null
              audioRef.current = null
              processNextRef.current()
            }

            audio.onended = cleanup
            audio.onerror = cleanup

            audio
              .play()
              .then(() => {
                setIsSpeaking(true)
                onAvatarStateChange('talking')
              })
              .catch(cleanup)
          },
          onError: () => {
            processNextRef.current()
          },
        },
      )
    }
  }, [synthesizeSpeech, voice, speed, stopSpeaking, onAvatarStateChange])

  const onSentence = useCallback((sentence: string) => {
    audioQueueRef.current.push(sentence)
    if (!isPlayingRef.current) {
      isPlayingRef.current = true
      processNextRef.current()
    }
  }, [])

  const { reset: resetSentenceSpeech } = useSentenceSpeech({
    messages,
    status,
    onSentence,
    enabled,
  })

  const forceStop = useCallback(() => {
    clearCurrentAudio()
    audioQueueRef.current = []
    isPlayingRef.current = false
    resetSentenceSpeech()
    onStopStream()
    setIsSpeaking(false)
    onAvatarStateChange('idle')
  }, [
    clearCurrentAudio,
    resetSentenceSpeech,
    onStopStream,
    onAvatarStateChange,
  ])

  useEffect(() => {
    return () => {
      clearCurrentAudio()
    }
  }, [clearCurrentAudio])

  return { isSpeaking, forceStop }
}
