// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { isFileUIPart, isToolUIPart } from 'ai'
import { Loader } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { withoutThinkTags } from '@/lib/llm/reasoning-parsers'
import { cn } from '@/lib/utils'
import {
  type ChatMsg,
  extractTextContent,
  getMessageOutcome,
} from '../lib/chat-helpers'
import { AssistantAvatar, type AssistantAvatarStyle } from './assistant-avatar'
import { AttachmentImage } from './attachment-image'
import { CopyMessageButton, OutcomeLabel, SpeakButton } from './message-actions'
import { ReasoningBlock } from './reasoning-block'
import { ToolCallBlock } from './tool-call-block'

interface ChatMessageProps extends AssistantAvatarStyle {
  msg: ChatMsg
  isLastAssistant: boolean
  isRunning: boolean
  /** Reads the message aloud, or stops it while `isSpeaking`. */
  onSpeak?: (text: string) => void
  isSpeaking?: boolean
}

function UserMessage({ msg }: { msg: ChatMsg }) {
  const textContent = extractTextContent(msg)
  const outcome = getMessageOutcome(msg)
  const files = msg.parts.filter(isFileUIPart)
  if (textContent.trim() === '' && files.length === 0) return null

  return (
    <div className="flex justify-end gap-2">
      <div
        className={cn(
          'flex max-w-[85%] flex-col',
          files.length > 0 ? 'items-end gap-1.5' : 'gap-1',
        )}
      >
        {/* A message's parts never move: their position is their identity. */}
        {files.map((file, i) => (
          <AttachmentImage key={i} src={file.url} className="shadow-sm" />
        ))}
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm">
          <span className="whitespace-pre-wrap">{textContent}</span>
        </div>
        {outcome && (
          <div className="flex justify-end">
            <OutcomeLabel outcome={outcome} />
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({
  msg,
  isStreaming,
  onSpeak,
  isSpeaking,
  avatarClassName,
  avatarTextClassName,
}: Omit<ChatMessageProps, 'isLastAssistant' | 'isRunning'> & {
  isStreaming: boolean
}) {
  // What Copy and Listen take: without a stray reasoning tag.
  const textContent = withoutThinkTags(extractTextContent(msg))
  const outcome = getMessageOutcome(msg)
  const hasText = textContent.trim() !== ''
  const hasContent = msg.parts.some(
    (p) =>
      ((p.type === 'text' || p.type === 'reasoning') && p.text.trim() !== '') ||
      p.type === 'file' ||
      isToolUIPart(p),
  )
  if (!hasContent) return null

  return (
    <div className="flex items-start justify-start gap-2">
      <AssistantAvatar
        avatarClassName={avatarClassName}
        avatarTextClassName={avatarTextClassName}
      />
      <div className="flex max-w-[85%] min-w-0 flex-col gap-2 overflow-hidden">
        {/* Parts are only appended while streaming, so position is identity; tool calls have ids. */}
        {msg.parts.map((part, i) => {
          if (part.type === 'reasoning') {
            return (
              <ReasoningBlock
                key={`r-${i}`}
                text={part.text}
                isStreaming={isStreaming && part.state === 'streaming'}
              />
            )
          }
          if (part.type === 'text' && part.text.trim()) {
            return (
              <div
                key={`t-${i}`}
                className="text-foreground text-sm leading-relaxed"
                data-testid="assistant-message"
              >
                <Streamdown animated isAnimating={isStreaming}>
                  {part.text}
                </Streamdown>
              </div>
            )
          }
          if (part.type === 'file') {
            return <AttachmentImage key={`f-${i}`} src={part.url} />
          }
          if (isToolUIPart(part)) {
            return <ToolCallBlock key={`tc-${part.toolCallId}`} part={part} />
          }
          return null
        })}

        {(outcome || (hasText && (onSpeak || !isStreaming))) && (
          <div className="flex flex-wrap items-center gap-1">
            {outcome && <OutcomeLabel outcome={outcome} />}
            {hasText && !isStreaming && (
              <CopyMessageButton text={textContent} />
            )}
            {onSpeak && hasText && (
              <SpeakButton
                speaking={Boolean(isSpeaking)}
                onToggle={() => onSpeak(textContent)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatMessage({
  msg,
  isLastAssistant,
  isRunning,
  ...assistant
}: ChatMessageProps) {
  if (msg.role === 'user') return <UserMessage msg={msg} />
  return (
    <AssistantMessage
      msg={msg}
      isStreaming={isLastAssistant && isRunning}
      {...assistant}
    />
  )
}

/** Shown after a message is sent, until the response has visible output. */
export function ThinkingIndicator(style: AssistantAvatarStyle) {
  return (
    <div
      role="status"
      data-testid="generating-indicator"
      className="flex items-start justify-start gap-2"
    >
      <AssistantAvatar {...style} />
      <div className="text-muted-foreground flex items-center gap-1.5 px-1 py-1.5 text-xs">
        <Loader aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
        Generating…
      </div>
    </div>
  )
}
