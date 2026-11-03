// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileAudio, Send, UserRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Service } from '@/services/types'
import { AudioLipsyncTab } from './components/audio-lipsync-tab'
import { AvatarStream } from './components/avatar-stream'
import { AvatarsTab } from './components/avatars-tab'
import { ChatTab } from './components/chat-tab'
import { LipsyncSteps } from './components/lipsync-steps'
import { useFrameGeneration } from './hooks/use-frame-generation'
import { useLipsyncWebRtc } from './hooks/use-lipsync-webrtc'

type LipsyncTab = 'audio' | 'chat' | 'avatars'

const isLipsyncTab = (value: string): value is LipsyncTab =>
  value === 'audio' || value === 'chat' || value === 'avatars'

export function LipsyncDemo({ service }: { service: Service }) {
  // Starts from the instance's Runtime Settings (and the Frame Generation
  // service running); the switch in each tab changes it for this visit.
  const [frameGeneration, setFrameGeneration] = useFrameGeneration(service)
  const [tab, setTab] = useState<LipsyncTab>('audio')

  const videoRef = useRef<HTMLVideoElement>(null)

  const {
    sessionId,
    statusMessage,
    isConnecting,
    isMediaConnected,
    connect,
    disconnect,
  } = useLipsyncWebRtc({ service, videoRef })

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,400px)]">
      <AvatarStream
        videoRef={videoRef}
        isConnected={sessionId !== null}
        isConnecting={isConnecting}
        isEstablishing={!isMediaConnected}
        statusMessage={statusMessage}
        sessionId={sessionId}
        onConnect={connect}
        onDisconnect={disconnect}
        offlineHint={`${service.label ?? service.name} is running. Connect to start an avatar session in this browser tab.`}
      />

      <div className="min-w-0 space-y-4">
        <LipsyncSteps
          service={service}
          sessionId={sessionId}
          isConnecting={isConnecting}
          onChooseAvatar={() => setTab('avatars')}
        />

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isLipsyncTab(value)) setTab(value)
          }}
        >
          <TabsList className="max-w-full flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
            <TabsTrigger value="audio">
              <FileAudio aria-hidden="true" className="h-3.5 w-3.5" />
              Audio
            </TabsTrigger>
            <TabsTrigger value="chat">
              <Send aria-hidden="true" className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="avatars">
              <UserRound aria-hidden="true" className="h-3.5 w-3.5" />
              Avatars
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-3">
            <ChatTab
              sessionId={sessionId}
              frameGeneration={frameGeneration}
              onFrameGenerationChange={setFrameGeneration}
              apiBase={service.apiBase}
            />
          </TabsContent>

          <TabsContent value="audio" className="space-y-4">
            <AudioLipsyncTab
              sessionId={sessionId}
              frameGeneration={frameGeneration}
              onFrameGenerationChange={setFrameGeneration}
              apiBase={service.apiBase}
            />
          </TabsContent>

          <TabsContent value="avatars" className="space-y-4">
            <AvatarsTab service={service} sessionId={sessionId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
