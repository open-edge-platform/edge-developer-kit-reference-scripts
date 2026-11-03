// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowDown, MessageSquare, Trash2 } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { useTtsPlaybackControls } from '@/context/tts-playback-context'
import { useVoiceInput } from '@/context/voice-input-context'
import { cn } from '@/lib/utils'
import { useFollowScroll } from '../hooks/use-follow-scroll'
import {
  type ChatAttachments,
  type ChatMsg,
  type ChatStatus,
  isLastMessageLoading,
} from '../lib/chat-helpers'
import type { AssistantAvatarStyle } from './assistant-avatar'
import { ChatErrorNotice } from './chat-error-notice'
import { ChatMessage, ThinkingIndicator } from './chat-message'
import { Composer } from './composer'
import { ImageAttachButton, ImageAttachPreviewList } from './image-attach'
import { VoiceInputButton } from './voice-input-button'

interface ConversationPanelProps extends AssistantAvatarStyle {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onReset: () => void

  disabled?: boolean
  /** Disables Send and Retry (e.g. the instance is stopped) but not typing. */
  sendDisabled?: boolean
  placeholder?: string
  textareaRows?: number

  emptyState?: ReactNode
  emptyStateText?: string
  /** Prompts offered in the default empty state; one fills the composer. */
  examplePrompts?: string[]

  /** Shown inline with Retry while `status` is 'error'. */
  error?: Error
  onRetry?: () => void

  /** Images attached to the draft, shown above the input. */
  attachments?: ChatAttachments
  /** Offers the Image button, for a model that accepts images. */
  allowImageAttach?: boolean

  sttOnline?: boolean
  ttsOnline?: boolean

  /** Controls at the end of the conversation toolbar, e.g. Parameters. */
  headerActions?: ReactNode
  toolbarExtra?: ReactNode
  inputExtra?: ReactNode

  className?: string
  messagesClassName?: string
}

function ExamplePrompts({
  prompts,
  disabled,
  onPick,
}: {
  prompts: string[]
  disabled?: boolean
  onPick: (prompt: string) => void
}) {
  return (
    <div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2">
      {prompts.map((prompt) => (
        <Button
          key={prompt}
          variant="outline"
          size="sm"
          className="h-auto min-h-9 text-xs font-normal whitespace-normal"
          disabled={disabled}
          onClick={() => onPick(prompt)}
        >
          {prompt}
        </Button>
      ))}
    </div>
  )
}

/** Chat conversation, toolbar and composer, with optional voice input, images and read-aloud. */
export function ConversationPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onReset,
  disabled,
  sendDisabled,
  placeholder = 'Type a message…',
  textareaRows = 1,
  emptyState,
  emptyStateText = 'Start a conversation',
  examplePrompts,
  error,
  onRetry,
  attachments,
  allowImageAttach,
  sttOnline,
  ttsOnline,
  avatarClassName,
  avatarTextClassName,
  headerActions,
  toolbarExtra,
  inputExtra,
  className,
  messagesClassName,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isRunning = status === 'submitted' || status === 'streaming'
  const voiceInput = useVoiceInput()
  const ttsPlayback = useTtsPlaybackControls()
  const follow = useFollowScroll(scrollRef, contentRef, {
    messages,
    status,
    error,
  })

  const showMic = !!sttOnline && voiceInput != null
  const showImageAttach = Boolean(allowImageAttach && attachments)
  const toolbar = (showMic ||
    showImageAttach ||
    toolbarExtra !== undefined) && (
    <>
      {showMic && voiceInput && (
        <VoiceInputButton
          voiceInput={voiceInput}
          disabled={disabled || isRunning}
        />
      )}
      {showImageAttach && attachments && (
        <ImageAttachButton
          onFiles={attachments.attach}
          disabled={disabled || isRunning}
        />
      )}
      {toolbarExtra}
    </>
  )
  const attachedImages = attachments && attachments.previews.length > 0 && (
    <ImageAttachPreviewList attachments={attachments} />
  )
  const showHeader = messages.length > 0 || headerActions !== undefined
  const avatarStyle = { avatarClassName, avatarTextClassName }

  return (
    <div
      className={cn(
        'border-border bg-muted/10 flex min-h-[320px] flex-col rounded-xl border',
        className,
      )}
    >
      {showHeader && (
        <div className="border-border flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2 text-xs"
              onClick={onReset}
              disabled={isRunning}
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              Clear conversation
            </Button>
          )}
          {headerActions !== undefined && (
            <div className="ml-auto flex items-center gap-1.5">
              {headerActions}
            </div>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={follow.onScroll}
          onWheel={follow.onWheel}
          aria-busy={isRunning}
          className={cn(
            'min-h-0 flex-1 overflow-x-hidden p-4',
            messages.length > 0 || status !== 'ready'
              ? 'overflow-y-auto'
              : 'overflow-hidden',
            messagesClassName,
          )}
        >
          <div
            ref={contentRef}
            className={cn('space-y-4', messages.length === 0 && 'h-full')}
          >
            {messages.length === 0
              ? (emptyState ?? (
                  <EmptyState
                    icon={MessageSquare}
                    size="sm"
                    description={emptyStateText}
                    className="h-full py-10"
                  >
                    {examplePrompts && examplePrompts.length > 0 && (
                      <ExamplePrompts
                        prompts={examplePrompts}
                        disabled={disabled}
                        onPick={(prompt) => {
                          onInputChange(prompt)
                          textareaRef.current?.focus()
                        }}
                      />
                    )}
                  </EmptyState>
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
                      ttsOnline && ttsPlayback
                        ? (text) => ttsPlayback.handleSpeak(text, msg.id)
                        : undefined
                    }
                    isSpeaking={ttsPlayback?.speakingMsgId === msg.id}
                    {...avatarStyle}
                  />
                ))}

            {(status === 'submitted' ||
              (status === 'streaming' && isLastMessageLoading(messages))) && (
              <ThinkingIndicator {...avatarStyle} />
            )}

            {status === 'error' && error && (
              <ChatErrorNotice
                error={error}
                onRetry={onRetry}
                retryDisabled={sendDisabled}
              />
            )}
          </div>
        </div>

        {!follow.following && messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={follow.jumpToLatest}
            className="bg-background absolute bottom-3 left-1/2 h-8 -translate-x-1/2 gap-1.5 rounded-full text-xs shadow-sm"
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" />
            Jump to latest
          </Button>
        )}
      </div>

      <Composer
        textareaRef={textareaRef}
        input={input}
        onInputChange={onInputChange}
        onSend={onSend}
        onStop={onStop}
        isRunning={isRunning}
        disabled={disabled}
        sendDisabled={sendDisabled}
        placeholder={placeholder}
        rows={textareaRows}
        toolbar={toolbar}
        inputExtra={
          (attachedImages || inputExtra) && (
            <>
              {attachedImages}
              {inputExtra}
            </>
          )
        }
      />
    </div>
  )
}
