// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImagePlus, Keyboard, MessageSquare, Mic, Sparkles } from 'lucide-react'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import type { useTextGenChat } from '@/services/text-generation/hooks/use-chat'

interface ChatPanelProps {
  chat: ReturnType<typeof useTextGenChat>
  /** Stops the reply and the avatar's speech. */
  onStop: () => void
  isConnected: boolean
  sttOnline?: boolean
  isVlm?: boolean
}

export function ChatPanel({
  chat,
  onStop,
  isConnected,
  sttOnline,
  isVlm,
}: ChatPanelProps) {
  return (
    <ConversationPanel
      messages={chat.messages}
      status={chat.status}
      input={chat.input}
      onInputChange={chat.setInput}
      onSend={() => chat.handleSend()}
      onStop={onStop}
      onReset={chat.handleReset}
      error={chat.error}
      onRetry={chat.handleRetry}
      disabled={!isConnected}
      sttOnline={sttOnline}
      attachments={chat.attachments}
      allowImageAttach={isVlm}
      className="max-h-[600px]"
      placeholder={
        !isConnected ? 'Connect to the avatar first…' : 'Type a message…'
      }
      emptyState={
        isConnected ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="bg-primary/10 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <Sparkles className="text-primary h-6 w-6" aria-hidden />
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
                <Keyboard className="h-3 w-3" aria-hidden /> Text input
              </span>
              {sttOnline && (
                <span className="flex items-center gap-1">
                  <Mic className="h-3 w-3" aria-hidden /> Voice input
                </span>
              )}
              {isVlm && (
                <span className="flex items-center gap-1">
                  <ImagePlus className="h-3 w-3" aria-hidden /> Image input
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="bg-muted/60 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <MessageSquare
                className="text-muted-foreground/40 h-6 w-6"
                aria-hidden
              />
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
