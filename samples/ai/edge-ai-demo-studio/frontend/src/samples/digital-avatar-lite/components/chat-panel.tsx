// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { VlmChatPanel } from '@/services/text-generation/components/vlm-chat-panel'

interface ChatPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onReset: () => void
  sttOnline?: boolean
  disabled?: boolean
  isVlm?: boolean
  isSpeaking?: boolean
  imagePreviews?: string[]
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImageRemove?: (index: number) => void
}

export function ChatPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onReset,
  sttOnline,
  disabled,
  isVlm,
  isSpeaking,
  imagePreviews,
  onImageSelect,
  onImageRemove,
}: ChatPanelProps) {
  // Show the stop button while the avatar is speaking, even after LLM finishes
  const effectiveStatus =
    isSpeaking && status === 'ready' ? 'streaming' : status

  return (
    <VlmChatPanel
      messages={messages}
      status={effectiveStatus}
      input={input}
      onInputChange={onInputChange}
      onSend={onSend}
      onStop={onStop}
      onReset={onReset}
      disabled={disabled}
      sttOnline={sttOnline}
      isVlm={isVlm}
      imagePreviews={imagePreviews}
      onImageSelect={onImageSelect}
      onImageRemove={onImageRemove}
      emptyStateText="Start a conversation with the avatar"
      avatarClassName="bg-violet-500/15"
      avatarTextClassName="text-violet-600"
      className="min-h-[320px]"
      messagesClassName="max-h-[400px] min-h-[240px]"
    />
  )
}
