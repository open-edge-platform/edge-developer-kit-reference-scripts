// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ArrowUp,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  RotateCcw,
  Square,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSttRecording, useTtsPlayback } from '@/services/common/hooks'
import {
  type ChatMsg,
  type ChatStatus,
  handleChatKeyDown,
  isLastMessageLoading,
} from './chat-helpers'
import { ChatMessage, ThinkingIndicator } from './chat-message'

interface ConversationPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onReset: () => void

  disabled?: boolean
  placeholder?: string
  textareaRows?: number

  emptyState?: ReactNode
  emptyStateText?: string

  sttOnline?: boolean
  ttsOnline?: boolean
  ttsVoice?: string
  ttsSpeed?: number

  avatarClassName?: string
  avatarTextClassName?: string

  toolbarExtra?: ReactNode
  inputExtra?: ReactNode

  className?: string
  messagesClassName?: string
}

export function ConversationPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onReset,
  disabled,
  placeholder = 'Type a message…',
  textareaRows = 1,
  emptyState,
  emptyStateText = 'Start a conversation',
  sttOnline,
  ttsOnline,
  ttsVoice,
  ttsSpeed,
  avatarClassName,
  avatarTextClassName,
  toolbarExtra,
  inputExtra,
  className,
  messagesClassName,
}: ConversationPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isRunning = status === 'submitted' || status === 'streaming'

  const stt = useSttRecording({ onTranscription: onInputChange })
  const tts = useTtsPlayback({ voice: ttsVoice, speed: ttsSpeed })

  useEffect(() => {
    if (messages.length > 0 || status !== 'ready') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, status])

  // Keep scrolling to bottom while streaming
  useEffect(() => {
    if (status !== 'streaming' && status !== 'submitted') return
    const id = setInterval(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 300)
    return () => clearInterval(id)
  }, [status])

  const showToolbar =
    messages.length > 0 || sttOnline || toolbarExtra !== undefined

  return (
    <div
      className={cn(
        'border-border bg-muted/10 flex min-h-[420px] flex-col rounded-xl border',
        className,
      )}
    >
      <div
        className={cn(
          'min-h-0 flex-1 space-y-4 overflow-x-hidden p-4',
          messages.length > 0 || status !== 'ready'
            ? 'overflow-y-auto'
            : 'overflow-hidden',
          messagesClassName,
        )}
      >
        {messages.length === 0
          ? (emptyState ?? (
              <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                <MessageSquare className="text-muted-foreground/40 mb-3 h-10 w-10" />
                <p className="text-muted-foreground text-sm">
                  {emptyStateText}
                </p>
              </div>
            ))
          : messages.map((msg, i) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                isLastAssistant={
                  msg.role !== 'user' && i === messages.length - 1
                }
                isRunning={isRunning}
                onSpeak={
                  ttsOnline
                    ? (text) => tts.handleSpeak(text, msg.id)
                    : undefined
                }
                isSpeaking={tts.speakingMsgId === msg.id}
                avatarClassName={avatarClassName}
                avatarTextClassName={avatarTextClassName}
              />
            ))}

        {(status === 'submitted' ||
          (status === 'streaming' && isLastMessageLoading(messages))) && (
          <ThinkingIndicator
            avatarClassName={avatarClassName}
            avatarTextClassName={avatarTextClassName}
          />
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-border border-t p-3">
        {showToolbar && (
          <div className="mb-2 flex items-center gap-1.5">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
                onClick={onReset}
                disabled={isRunning}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            {sttOnline && (
              <TooltipProvider>
                <Tooltip open={stt.micError ? undefined : false}>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={
                        stt.isRecording ? stt.stopRecording : stt.startRecording
                      }
                      variant={
                        stt.isRecording
                          ? 'destructive'
                          : stt.micError
                            ? 'outline'
                            : 'ghost'
                      }
                      size="sm"
                      className={cn(
                        'h-7 gap-1.5 px-2 text-xs',
                        !stt.isRecording &&
                          !stt.micError &&
                          'text-muted-foreground hover:text-foreground',
                        stt.micError &&
                          'text-destructive border-destructive/50',
                      )}
                      disabled={disabled || isRunning || stt.isPending}
                    >
                      {stt.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : stt.isRecording ? (
                        <>
                          <Square className="h-3 w-3" />
                          Stop
                        </>
                      ) : stt.micError ? (
                        <>
                          <MicOff className="h-3.5 w-3.5" />
                          Voice
                        </>
                      ) : (
                        <>
                          <Mic className="h-3.5 w-3.5" />
                          Voice
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56 text-center">
                    {stt.micError}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {toolbarExtra}
          </div>
        )}

        <div className="bg-muted/30 border-input focus-within:border-ring focus-within:ring-ring/50 relative rounded-md border shadow-xs focus-within:ring-[3px]">
          {inputExtra && <div className="px-3 pt-2">{inputExtra}</div>}
          <Textarea
            data-testid="chat-input"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => handleChatKeyDown(e, onSend)}
            placeholder={placeholder}
            disabled={disabled || isRunning}
            rows={textareaRows}
            className="field-sizing-fixed !min-h-9 resize-none border-none pr-12 text-sm shadow-none focus-visible:ring-0"
          />
          {isRunning && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="destructive"
              className="absolute top-1 right-1.5 bottom-1.5 h-7 w-7"
              data-testid="stop-chat-button"
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              onClick={onSend}
              size="icon"
              disabled={disabled || !input.trim() || isRunning}
              data-testid="send-chat-button"
              className="bg-primary hover:bg-primary-light absolute top-1 right-1.5 bottom-1.5 h-7 w-7 text-white"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
