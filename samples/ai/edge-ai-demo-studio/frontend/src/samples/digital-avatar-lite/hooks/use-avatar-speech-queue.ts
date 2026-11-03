// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useSentenceSpeech } from '@/samples/common/hooks'
import { useServiceApiBase } from '@/context/service-status-context'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/lib/chat-helpers'
import { useSpeechSynthesizer } from '@/services/text-to-speech/hooks/use-synthesize-speech'

/** Sentences synthesized ahead of playback, so the next is usually ready when the current one ends. */
const SYNTHESIS_LOOKAHEAD = 2

interface QueuedSentence {
  text: string
  controller: AbortController
  /** Its audio once synthesis has started; `null` when synthesis failed. */
  audio?: Promise<Blob | null>
}

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
  // From the first sentence queued until the last has played, including waits for audio.
  const [isActive, setIsActive] = useState(false)
  const ttsApiBase = useServiceApiBase('text-to-speech')
  const synthesizeSpeech = useSpeechSynthesizer(ttsApiBase)
  /** Sentences not yet playing, next first. */
  const queueRef = useRef<QueuedSentence[]>([])
  const isPlayingRef = useRef(false)
  /** Bumped on stop, so audio still arriving for a stopped queue is dropped. */
  const generationRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const processNextRef = useRef<() => void>(() => {})
  const synthesizeAheadRef = useRef<() => void>(() => {})

  // Memoized by hand: these are effect dependencies (the unmount cleanup must not re-run
  // mid-reply). The two refs above are not effect events because audio/promise callbacks call them.
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

  const cancelPending = useCallback(() => {
    generationRef.current += 1
    for (const sentence of queueRef.current) sentence.controller.abort()
    queueRef.current = []
  }, [])

  const stopSpeaking = useCallback(() => {
    isPlayingRef.current = false
    setIsSpeaking(false)
    setIsActive(false)
    onAvatarStateChange('idle')
  }, [onAvatarStateChange])

  // A layout effect, ahead of useSentenceSpeech's below: they queue sentences
  // in the same commit and must find these up to date.
  useLayoutEffect(() => {
    synthesizeAheadRef.current = () => {
      for (const sentence of queueRef.current.slice(0, SYNTHESIS_LOOKAHEAD)) {
        if (sentence.audio === undefined) {
          sentence.audio = synthesizeSpeech(
            {
              input: sentence.text,
              voice,
              speed,
              responseFormat: 'mp3',
            },
            sentence.controller.signal,
          ).catch(() => null)
        }
      }
    }

    processNextRef.current = () => {
      synthesizeAheadRef.current()
      const next = queueRef.current[0]
      if (!next?.audio) {
        stopSpeaking()
        return
      }

      const generation = generationRef.current
      next.audio.then((blob) => {
        if (generation !== generationRef.current) return
        queueRef.current.shift()
        // The sentence behind the lookahead window starts now.
        synthesizeAheadRef.current()
        if (!blob) {
          processNextRef.current()
          return
        }

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
      })
    }
  }, [synthesizeSpeech, voice, speed, stopSpeaking, onAvatarStateChange])

  const onSentence = useCallback((sentence: string) => {
    queueRef.current.push({ text: sentence, controller: new AbortController() })
    if (isPlayingRef.current) {
      synthesizeAheadRef.current()
    } else {
      isPlayingRef.current = true
      setIsActive(true)
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
    cancelPending()
    isPlayingRef.current = false
    resetSentenceSpeech()
    onStopStream()
    setIsSpeaking(false)
    setIsActive(false)
    onAvatarStateChange('idle')
  }, [
    clearCurrentAudio,
    cancelPending,
    resetSentenceSpeech,
    onStopStream,
    onAvatarStateChange,
  ])

  useEffect(() => {
    return () => {
      clearCurrentAudio()
      cancelPending()
    }
  }, [clearCurrentAudio, cancelPending])

  return { isSpeaking, isActive, forceStop }
}
