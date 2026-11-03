// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FeatureContexts } from '@/samples/common/feature-providers/feature-contexts'
import { useSampleChatFeatures } from '@/samples/common/feature-providers/use-sample-chat-features'
import { useTextGenerationParams } from '@/samples/common/hooks'
import { useTextGenModelSupport } from '@/samples/common/hooks/use-text-gen-model'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { useTtsParams } from '@/services/text-to-speech/hooks/use-tts-params'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import type { Sample } from '../types'
import { AvatarSection } from './components/avatar-section'
import { ChatPanel } from './components/chat-panel'
import { useAvatarSpeechQueue } from './hooks/use-avatar-speech-queue'
import { useAvatarState } from './hooks/use-avatar-state'

export function DigitalAvatarLiteDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  // TTS is required, so used directly; optional integrations come from data.ts.
  const tts = useTtsParams(sample.id, { optional: false })
  const features = useSampleChatFeatures(sample)
  const { isMultimodal } = useTextGenModelSupport()
  const setAvatarState = useAvatarState()

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: features.extraBody,
  })

  const { isSpeaking, isActive, forceStop } = useAvatarSpeechQueue({
    messages: chat.messages,
    status: chat.status,
    enabled: tts.online,
    voice: tts.values.voice,
    speed: tts.values.speed,
    onStopStream: chat.handleStop,
    onAvatarStateChange: setAvatarState,
  })

  return (
    <div className="space-y-4">
      {features.renderProviders(chat.setInput)}

      <SampleParamsSlot
        groups={[textGen.group, tts.group, ...features.groups]}
      />

      <FeatureContexts exports={features.exports}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
          <AvatarSection
            streamUrl="/api/digital-avatar-lite/stream"
            isSpeaking={isSpeaking}
          />
          <ChatPanel
            chat={chat}
            onStop={forceStop}
            isSpeaking={isActive}
            sttOnline={features.sttOnline}
            isVlm={isMultimodal}
          />
        </div>
      </FeatureContexts>
    </div>
  )
}
