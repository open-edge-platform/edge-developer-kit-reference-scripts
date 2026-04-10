// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useGetService } from '@/context/service-status-context'
import {
  useOptionalServiceGroup,
  useRagChatSetup,
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
import { extractTextContent } from '@/services/text-generation/components/chat-helpers'

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
  // ── Parameter groups ─────────────────────────────────────────
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

  // ── Avatar state ─────────────────────────────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false)
  const updateAvatarState = useUpdateAvatarState()

  // ── Chat (text-generation) ───────────────────────────────────
  const chat = useTextGenChat({ textGenValues: textGen.values, extraBody })

  // ── Wake word → auto-trigger STT recording ──────────────────
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

  // ── Auto-speak AI response through TTS + avatar ──────────────
  const synthesizeSpeech = useSynthesizeSpeech()
  const prevMessageCountRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (chat.status !== 'ready') return
    if (!tts.online) return
    if (chat.messages.length <= prevMessageCountRef.current) {
      prevMessageCountRef.current = chat.messages.length
      return
    }
    prevMessageCountRef.current = chat.messages.length

    const lastMsg = chat.messages[chat.messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    const text = extractTextContent(lastMsg)

    if (!text.trim()) return

    setIsSpeaking(true)
    updateAvatarState.mutate({ state: 'talking' })

    synthesizeSpeech.mutate(
      {
        input: text.trim(),
        voice: tts.values.voice,
        speed: tts.values.speed,
        responseFormat: 'mp3',
      },
      {
        onSuccess: (blob) => {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioRef.current = audio

          audio.onended = () => {
            setIsSpeaking(false)
            updateAvatarState.mutate({ state: 'idle' })
            URL.revokeObjectURL(url)
            audioRef.current = null
          }

          audio.onerror = () => {
            setIsSpeaking(false)
            updateAvatarState.mutate({ state: 'idle' })
            URL.revokeObjectURL(url)
            audioRef.current = null
          }

          audio.play()
        },
        onError: () => {
          setIsSpeaking(false)
          updateAvatarState.mutate({ state: 'idle' })
        },
      },
    )
    // Only trigger when status transitions to 'ready' (response complete)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
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

      {/* Main layout */}
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
          onStop={chat.handleStop}
          onReset={chat.handleReset}
          sttOnline={stt.enabled}
          isVlm={isMultimodal}
          imagePreview={chat.imagePreview}
          onImageSelect={chat.handleImageSelect}
          onImageRemove={chat.handleRemoveImage}
        />
      </div>
    </div>
  )
}
