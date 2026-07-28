// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import {
  ImageAttachButton,
  ImageAttachPreviewList,
} from '@/services/text-generation/components/image-attach'

interface ChatPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  hasKnowledgeBase: boolean
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onReset: () => void
  sttOnline?: boolean
  ttsOnline?: boolean
  ttsVoice?: string
  ttsSpeed?: number
  isVlm?: boolean
  imagePreviews?: string[]
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImageRemove?: (index: number) => void
}

export function ChatPanel({
  messages,
  status,
  hasKnowledgeBase,
  input,
  onInputChange,
  onSend,
  onReset,
  sttOnline,
  ttsOnline,
  ttsVoice,
  ttsSpeed,
  isVlm,
  imagePreviews,
  onImageSelect,
  onImageRemove,
}: ChatPanelProps) {
  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    <>
      <ConversationPanel
        messages={messages}
        status={status}
        input={input}
        onInputChange={onInputChange}
        onSend={onSend}
        onReset={onReset}
        sttOnline={sttOnline}
        ttsOnline={ttsOnline}
        ttsVoice={ttsVoice}
        ttsSpeed={ttsSpeed}
        inputExtra={
          imagePreviews?.length ? (
            <ImageAttachPreviewList
              srcs={imagePreviews}
              onRemove={onImageRemove}
            />
          ) : undefined
        }
        toolbarExtra={
          isVlm ? (
            <ImageAttachButton
              onSelect={onImageSelect}
              disabled={!hasKnowledgeBase || isRunning}
            />
          ) : undefined
        }
        placeholder={
          !hasKnowledgeBase
            ? 'Set up a knowledge base first…'
            : 'Ask a question about your documents…'
        }
        emptyStateText={
          hasKnowledgeBase
            ? 'Ask a question about your documents'
            : 'Select a knowledge base and upload documents to start'
        }
        messagesClassName="max-h-[480px] min-h-[320px]"
      />
    </>
  )
}
