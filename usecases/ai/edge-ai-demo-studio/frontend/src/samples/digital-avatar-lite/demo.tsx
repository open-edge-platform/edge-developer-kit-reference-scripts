// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useGetService } from '@/context/service-status-context'
import {
  useOptionalServiceGroup,
  useRagChatSetup,
  useSentenceSpeech,
  useTextGenerationParams,
  useTtsParams,
  useWakeWordStt,
} from '@/samples/common/hooks'
import { useTextGenChat } from '@/services/text-generation/hooks'
import { useSynthesizeSpeech } from '@/services/text-to-speech/hooks'
import type { Sample } from '../types'
import { AvatarSection } from './components/avatar-section'
import { ChatPanel } from './components/chat-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'

function useUpdateAvatarState() {
  return useMutation({
    mutationFn: async (state: { state: 'idle' | 'talking' | 'waving' }) => {
      const res = await fetch('/api/digital-avatar-lite/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function DigitalAvatarLiteDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id, { optional: false })

  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })

  const { mcp, ragGroups, extraBody } = useRagChatSetup()

  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const [isSpeaking, setIsSpeaking] = useState(false)
  const updateAvatarState = useUpdateAvatarState()

  const chat = useTextGenChat({ textGenValues: textGen.values, extraBody })

  const { wakeWord } = useWakeWordStt({
    onTranscription: useCallback(
      (text: string) => {
        chat.setInput(text)
      },
      // chat.setInput is stable
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  })

  const synthesizeSpeech = useSynthesizeSpeech()
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const processNextRef = useRef<() => void>(() => {})

  const stopSpeaking = useCallback(() => {
    isPlayingRef.current = false
    setIsSpeaking(false)
    updateAvatarState.mutate({ state: 'idle' })
  }, [updateAvatarState])

  // Keep the processor in a ref so audio callbacks always call the latest version
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
          voice: tts.values.voice,
          speed: tts.values.speed,
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
                updateAvatarState.mutate({ state: 'talking' })
              })
              .catch(cleanup)
          },
          onError: () => {
            processNextRef.current()
          },
        },
      )
    }
  }, [
    synthesizeSpeech,
    tts.values.voice,
    tts.values.speed,
    stopSpeaking,
    updateAvatarState,
  ])

  const onSentence = useCallback((sentence: string) => {
    audioQueueRef.current.push(sentence)
    if (!isPlayingRef.current) {
      isPlayingRef.current = true
      processNextRef.current()
    }
  }, [])

  const { reset: resetSentenceSpeech } = useSentenceSpeech({
    messages: chat.messages,
    status: chat.status,
    onSentence,
    enabled: tts.online,
  })

  const forceStop = useCallback(() => {
    // Stop current audio and revoke its blob URL
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
    // Clear pending queue
    audioQueueRef.current = []
    isPlayingRef.current = false
    // Reset sentence processor
    resetSentenceSpeech()
    // Stop LLM streaming if in progress
    chat.handleStop()
    // Reset avatar state
    setIsSpeaking(false)
    updateAvatarState.mutate({ state: 'idle' })
  }, [resetSentenceSpeech, chat, updateAvatarState])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
        currentUrlRef.current = null
      }
    }
  }, [])

  return (
    <div className="space-y-4">
      <SampleParamsSlot
        groups={[
          textGen.group,
          tts.group,
          stt.group,
          wakeWord.group,
          ...ragGroups,
          mcp.group,
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
        <AvatarSection
          streamUrl="/api/digital-avatar-lite/stream"
          isSpeaking={isSpeaking}
        />
        <ChatPanel
          messages={chat.messages}
          status={chat.status}
          input={chat.input}
          onInputChange={chat.setInput}
          onSend={chat.handleSend}
          onStop={forceStop}
          onReset={chat.handleReset}
          sttOnline={stt.enabled}
          isVlm={isMultimodal}
          isSpeaking={isSpeaking}
          imagePreview={chat.imagePreview}
          onImageSelect={chat.handleImageSelect}
          onImageRemove={chat.handleRemoveImage}
        />
      </div>
    </div>
  )
}
