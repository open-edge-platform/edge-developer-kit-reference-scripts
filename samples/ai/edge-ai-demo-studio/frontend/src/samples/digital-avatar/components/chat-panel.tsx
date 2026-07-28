// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImagePlus, Keyboard, MessageSquare, Mic, Sparkles } from 'lucide-react'
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
  isConnected: boolean
  sttOnline?: boolean
  isVlm?: boolean
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
  isConnected,
  sttOnline,
  isVlm,
  imagePreviews,
  onImageSelect,
  onImageRemove,
}: ChatPanelProps) {
  return (
    <VlmChatPanel
      messages={messages}
      status={status}
      input={input}
      onInputChange={onInputChange}
      onSend={onSend}
      onStop={onStop}
      onReset={onReset}
      disabled={!isConnected}
      sttOnline={sttOnline}
      isVlm={isVlm}
      imagePreviews={imagePreviews}
      onImageSelect={onImageSelect}
      onImageRemove={onImageRemove}
      className="max-h-[600px]"
      placeholder={
        !isConnected ? 'Connect to the avatar first…' : 'Type a message…'
      }
      emptyState={
        isConnected ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="bg-primary/10 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <Sparkles className="text-primary h-6 w-6" />
            </div>
            <p className="text-foreground mb-1 text-sm font-medium">
              Ready to chat
            </p>
            <p className="text-muted-foreground max-w-[240px] text-xs leading-relaxed">
              Type a message below. The avatar will speak the AI&apos;s response
              with real-time lip sync.
            </p>
            <div className="text-muted-foreground/60 mt-5 flex flex-wrap items-center justify-center gap-3 text-[11px]">
              <span className="flex items-center gap-1">
                <Keyboard className="h-3 w-3" /> Text input
              </span>
              {sttOnline && (
                <span className="flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Voice input
                </span>
              )}
              {isVlm && (
                <span className="flex items-center gap-1">
                  <ImagePlus className="h-3 w-3" /> Image input
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="bg-muted/60 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <MessageSquare className="text-muted-foreground/40 h-6 w-6" />
            </div>
            <p className="text-muted-foreground max-w-[220px] text-sm leading-relaxed">
              Connect to the avatar stream to start chatting
            </p>
          </div>
        )
      }
    />
  )
}
