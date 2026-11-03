// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import type { useTextGenChat } from '@/services/text-generation/hooks/use-chat'

interface ChatPanelProps {
  chat: ReturnType<typeof useTextGenChat>
  /** Stops the reply and the avatar's speech. */
  onStop: () => void
  /** The avatar is still speaking the reply, or about to. */
  isSpeaking: boolean
  sttOnline?: boolean
  isVlm?: boolean
}

export function ChatPanel({
  chat,
  onStop,
  isSpeaking,
  sttOnline,
  isVlm,
}: ChatPanelProps) {
  // Show the stop button until the avatar has spoken the reply, even after
  // the LLM finishes
  const status =
    isSpeaking && chat.status === 'ready' ? 'streaming' : chat.status

  return (
    <ConversationPanel
      messages={chat.messages}
      status={status}
      input={chat.input}
      onInputChange={chat.setInput}
      onSend={() => chat.handleSend()}
      onStop={onStop}
      onReset={chat.handleReset}
      error={chat.error}
      onRetry={chat.handleRetry}
      sttOnline={sttOnline}
      attachments={chat.attachments}
      allowImageAttach={isVlm}
      emptyStateText="Start a conversation with the avatar"
      avatarClassName="bg-primary/15"
      avatarTextClassName="text-primary"
      className="min-h-[320px]"
      messagesClassName="max-h-[400px] min-h-[240px]"
    />
  )
}
