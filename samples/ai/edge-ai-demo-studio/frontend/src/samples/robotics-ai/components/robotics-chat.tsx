// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Brain } from 'lucide-react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import {
  type VoiceInputControls,
  VoiceInputProvider,
} from '@/context/voice-input-context'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import {
  DEFAULT_CHAT_SUGGESTIONS,
  type RoboticsChat as RoboticsChatState,
  type SendOptions,
} from '../hooks/use-robotics-chat'

/** The agent chat: the shared conversation panel, with the robot's microphone as its voice input. */
export function RoboticsChat({
  chat,
  mic,
  sendOptions,
}: {
  chat: RoboticsChatState
  mic: VoiceInputControls
  sendOptions: SendOptions
}) {
  const sttOnline = useServiceLiveStatus('speech-to-text') === 'online'

  return (
    <section
      aria-labelledby="robotics-chat-heading"
      className="glass-card relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl"
    >
      <div className="border-border border-b px-5 py-4">
        <h3
          id="robotics-chat-heading"
          className="text-foreground flex items-center gap-2 text-base font-semibold"
        >
          <Brain className="h-5 w-5" aria-hidden /> AI Chat Assistant
        </h3>
      </div>
      <VoiceInputProvider value={mic}>
        <ConversationPanel
          messages={chat.messages}
          status={chat.status}
          input={chat.input}
          onInputChange={chat.setInput}
          onSend={() => chat.send(sendOptions)}
          onStop={chat.stop}
          onReset={chat.reset}
          error={chat.error}
          onRetry={chat.retry}
          sttOnline={sttOnline}
          placeholder="Ask about the camera stream or AI analysis…"
          emptyStateText="Ask about the camera stream or the robot."
          examplePrompts={DEFAULT_CHAT_SUGGESTIONS}
          className="min-h-0 flex-1 rounded-none border-0 bg-transparent"
        />
      </VoiceInputProvider>
    </section>
  )
}
