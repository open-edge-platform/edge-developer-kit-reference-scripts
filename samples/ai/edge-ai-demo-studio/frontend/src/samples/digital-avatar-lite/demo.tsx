// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useGetService } from '@/context/service-status-context'
import { useOptionalServiceGroup } from '@/samples/common/hooks/use-optional-service-group'
import { useRagChatSetup } from '@/samples/common/hooks/use-rag-chat-setup'
import { useTextGenerationParams } from '@/samples/common/hooks/use-text-generation-params'
import { useTtsParams } from '@/samples/common/hooks/use-tts-params'
import { useWakeWordStt } from '@/samples/common/hooks/use-wake-word-stt'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { Sample } from '../types'
import { AvatarSection } from './components/avatar-section'
import { ChatPanel } from './components/chat-panel'
import { useAvatarSpeechQueue } from './hooks/use-avatar-speech-queue'
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

  const onAvatarStateChange = useCallback(
    (state: 'idle' | 'talking') => {
      updateAvatarState.mutate({ state })
    },
    [updateAvatarState],
  )

  const { isSpeaking, forceStop } = useAvatarSpeechQueue({
    messages: chat.messages,
    status: chat.status,
    enabled: tts.online,
    voice: tts.values.voice,
    speed: tts.values.speed,
    onStopStream: chat.handleStop,
    onAvatarStateChange,
  })

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
