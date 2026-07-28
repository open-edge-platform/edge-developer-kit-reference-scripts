// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import type { ChatMsg, ChatStatus } from './chat-helpers'
import { ConversationPanel } from './conversation-panel'
import { ImageAttachButton, ImageAttachPreviewList } from './image-attach'

interface VlmChatPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onReset: () => void
  disabled?: boolean
  sttOnline?: boolean
  ttsOnline?: boolean
  ttsVoice?: string
  ttsSpeed?: number
  isVlm?: boolean
  imagePreviews?: string[]
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImageRemove?: (index: number) => void
  /** Custom empty state; when omitted uses emptyStateText */
  emptyState?: ReactNode
  /** Short text used when emptyState is not provided */
  emptyStateText?: string
  placeholder?: string
  avatarClassName?: string
  avatarTextClassName?: string
  className?: string
  messagesClassName?: string
}

export function VlmChatPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onReset,
  disabled,
  sttOnline,
  ttsOnline,
  ttsVoice,
  ttsSpeed,
  isVlm,
  imagePreviews,
  onImageSelect,
  onImageRemove,
  emptyState,
  emptyStateText = 'Start a conversation',
  placeholder,
  avatarClassName,
  avatarTextClassName,
  className,
  messagesClassName,
}: VlmChatPanelProps) {
  const isRunning = status === 'submitted' || status === 'streaming'

  return (
    <>
      <ConversationPanel
        messages={messages}
        status={status}
        input={input}
        onInputChange={onInputChange}
        onSend={onSend}
        onStop={onStop}
        onReset={onReset}
        disabled={disabled}
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
              disabled={disabled || isRunning}
            />
          ) : undefined
        }
        emptyState={emptyState}
        emptyStateText={emptyStateText}
        placeholder={placeholder}
        avatarClassName={avatarClassName}
        avatarTextClassName={avatarTextClassName}
        className={className}
        messagesClassName={messagesClassName}
      />
    </>
  )
}
