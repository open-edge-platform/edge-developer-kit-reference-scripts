// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useGetService } from '@/context/service-status-context'
import { useFeatureCollector } from '@/context/feature-collector'
import {
  FeatureContexts,
  sttOnlineFromExports,
} from '@/samples/common/feature-providers/feature-contexts'
import { useFeatureProviders } from '@/samples/common/feature-providers/use-feature-providers'
import { useTextGenerationParams } from '@/samples/common/hooks/use-text-generation-params'
import { useTtsParams } from '@/services/text-to-speech/hooks/use-tts-params'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { Sample } from '../types'
import { AvatarSection } from './components/avatar-section'
import { ChatPanel } from './components/chat-panel'
import { useAvatarSpeechQueue } from './hooks/use-avatar-speech-queue'
import { SampleParamsSlot } from '../common/sample-params-slot'

// Optional-service feature integrations this sample wires (explicit opt-in).
// TTS is required (handled directly). See docs/OPTIONAL-SERVICES.md.
const FEATURE_SERVICES = [
  'speech-to-text',
  'wake-word-detection',
  'vectordb',
  'mcp',
]

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

  const featureProviders = useFeatureProviders(FEATURE_SERVICES)
  const collector = useFeatureCollector(FEATURE_SERVICES)
  const sttOnline = sttOnlineFromExports(collector.exports)

  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const updateAvatarState = useUpdateAvatarState()

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: collector.extraBody,
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
      <collector.Provider>
        {featureProviders.map(({ serviceId, Provider }) => (
          <Provider
            key={serviceId}
            onTranscription={chat.setInput}
            sampleId={sample.id}
          />
        ))}
      </collector.Provider>

      <SampleParamsSlot
        groups={[textGen.group, tts.group, ...collector.groups]}
      />

      <FeatureContexts exports={collector.exports}>
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
            sttOnline={sttOnline}
            isVlm={isMultimodal}
            isSpeaking={isSpeaking}
            imagePreviews={chat.imagePreviews}
            onImageSelect={chat.handleImageSelect}
            onImageRemove={chat.handleRemoveImage}
          />
        </div>
      </FeatureContexts>
    </div>
  )
}
