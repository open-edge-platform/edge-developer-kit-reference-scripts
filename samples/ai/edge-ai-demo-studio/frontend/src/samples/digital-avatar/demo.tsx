// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef } from 'react'
import { useGetService } from '@/context/service-status-context'
import { FeatureContexts } from '@/samples/common/feature-providers/feature-contexts'
import { useSampleChatFeatures } from '@/samples/common/feature-providers/use-sample-chat-features'
import { useTextGenerationParams } from '@/samples/common/hooks'
import { useTextGenModelSupport } from '@/samples/common/hooks/use-text-gen-model'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import { useTtsParams } from '@/services/text-to-speech/hooks/use-tts-params'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import { AvatarStream } from '@/services/lipsync/components/avatar-stream'
import { useLipsyncStop } from '@/services/lipsync/hooks'
import { frameGenerationAllowed } from '@/services/lipsync/hooks/use-frame-generation'
import { useLipsyncWebRtc } from '@/services/lipsync/hooks/use-lipsync-webrtc'
import type { Sample } from '../types'
import { ChatPanel } from './components/chat-panel'

export function DigitalAvatarDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  // TTS and lipsync are required, so used directly; optional integrations come from data.ts.
  const tts = useTtsParams(sample.id, { optional: false })
  const features = useSampleChatFeatures(sample)
  const { isMultimodal } = useTextGenModelSupport()

  const videoRef = useRef<HTMLVideoElement>(null)

  const lipsyncService = useGetService('lipsync')
  // Requested when the optional service runs and the lipsync instance allows it; the worker
  // only interpolates when inference cannot keep up with the avatar frame rate.
  const frameGenerationOn =
    useGetService('frame-generation')?.status === 'online' &&
    frameGenerationAllowed(lipsyncService)

  const {
    sessionId,
    statusMessage,
    isConnecting,
    isMediaConnected,
    connect,
    disconnect,
  } = useLipsyncWebRtc({ service: lipsyncService, videoRef })

  // The chat route splits sentences and resolves the lipsync and TTS workers itself (never from
  // the client), honouring the instances this sample binds.
  const lipsyncExtraBody = sessionId
    ? {
        lipsync: {
          sessionId,
          voice: tts.values.voice,
          speed: String(tts.values.speed),
          frameGeneration: frameGenerationOn,
        },
      }
    : {}

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: { ...features.extraBody, ...lipsyncExtraBody },
  })

  const isSpeaking = chat.status === 'streaming' && !!sessionId

  // The chat route stops lipsync only once its in-flight sentence lands; stopping here too
  // silences the avatar right away.
  const { mutate: stopLipsync } = useLipsyncStop(lipsyncService?.apiBase)
  const handleStop = () => {
    chat.handleStop()
    if (sessionId) stopLipsync(sessionId)
  }

  return (
    <div className="space-y-5">
      {features.renderProviders(chat.setInput)}

      <FeatureContexts exports={features.exports}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(0,400px)]">
          <AvatarStream
            videoRef={videoRef}
            isConnected={sessionId !== null}
            isConnecting={isConnecting}
            isEstablishing={!isMediaConnected}
            statusMessage={statusMessage}
            isSpeaking={isSpeaking}
            onConnect={connect}
            onDisconnect={disconnect}
          />
          <SampleParamsSlot
            groups={[textGen.group, tts.group, ...features.groups]}
          />
          <ChatPanel
            chat={chat}
            onStop={handleStop}
            isConnected={sessionId !== null}
            sttOnline={features.sttOnline}
            isVlm={isMultimodal}
          />
        </div>
      </FeatureContexts>
    </div>
  )
}
