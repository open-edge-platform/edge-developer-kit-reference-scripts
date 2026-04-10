// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Brain,
  Check,
  ChevronRight,
  Loader2,
  Volume2,
  Wrench,
  XCircle,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import { ChatMsg, extractTextContent } from './chat-helpers'

// ── Tool-part helpers ────────────────────────────────────────────

interface ToolPartShape {
  type: string
  toolCallId: string
  toolName?: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

function hasToolCallId(
  part: ChatMsg['parts'][number],
): part is ChatMsg['parts'][number] & ToolPartShape {
  return 'toolCallId' in part
}

function resolveToolName(part: ToolPartShape): string {
  if (part.toolName) return part.toolName
  if (part.type.startsWith('tool-')) return part.type.slice(5)
  return 'tool'
}

function formatToolName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Reasoning Block ──────────────────────────────────────────────

function ReasoningBlock({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const showContent = isStreaming || expanded
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, isStreaming])

  if (!text.trim() && !isStreaming) return null

  return (
    <div
      className={cn(
        'border-border/50 bg-primary/5 border-l-primary/60 max-w-full overflow-hidden rounded-xl border-l-2',
      )}
    >
      <button
        type="button"
        onClick={() => !isStreaming && setExpanded(!expanded)}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          !isStreaming && 'hover:bg-primary/10 cursor-pointer',
        )}
      >
        <div className="bg-primary/15 flex h-5 w-5 items-center justify-center rounded-full">
          <Brain className="text-primary h-3 w-3 shrink-0" />
        </div>
        <span className="text-primary dark:text-primary-dark font-medium">
          {isStreaming ? 'Thinking…' : 'Reasoning'}
        </span>
        {isStreaming ? (
          <Loader2 className="text-primary ml-auto h-3 w-3 animate-spin" />
        ) : (
          <ChevronRight
            className={cn(
              'text-muted-foreground/60 ml-auto h-3 w-3 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        )}
      </button>
      {showContent && (
        <div className="text-muted-foreground border-primary/20 border-t px-3 pt-2 pb-3 text-xs leading-relaxed italic">
          <div ref={scrollRef} className="max-h-64 min-w-0 overflow-auto">
            <span className="break-words whitespace-pre-wrap">{text}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tool Call Block ──────────────────────────────────────────────

function ToolCallBlock({ part }: { part: ToolPartShape }) {
  const [expanded, setExpanded] = useState(false)
  const name = formatToolName(resolveToolName(part))
  const isProcessing =
    part.state === 'input-streaming' || part.state === 'input-available'
  const isDone = part.state === 'output-available'
  const isError = part.state === 'output-error'

  const borderColor = isProcessing
    ? 'border-l-blue-500/60'
    : isDone
      ? 'border-l-emerald-500/60'
      : isError
        ? 'border-l-destructive/60'
        : 'border-l-muted-foreground/30'

  return (
    <div
      className={cn(
        'border-border/50 bg-muted/20 max-w-full overflow-hidden rounded-xl border-l-2',
        borderColor,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-muted/30 flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
      >
        {isProcessing ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/15">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          </div>
        ) : isDone ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-3 w-3 text-emerald-500" />
          </div>
        ) : isError ? (
          <div className="bg-destructive/15 flex h-5 w-5 items-center justify-center rounded-full">
            <XCircle className="text-destructive h-3 w-3" />
          </div>
        ) : (
          <div className="bg-muted-foreground/15 flex h-5 w-5 items-center justify-center rounded-full">
            <Wrench className="text-muted-foreground h-3 w-3" />
          </div>
        )}
        <span className="text-foreground min-w-0 truncate font-medium">
          {name}
        </span>
        {isProcessing && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            running
          </span>
        )}
        {isDone && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            completed
          </span>
        )}
        {isError && (
          <span className="bg-destructive/10 text-destructive max-w-[10rem] truncate rounded-full px-2 py-0.5 text-[10px] font-medium">
            {part.errorText ?? 'failed'}
          </span>
        )}
        <ChevronRight
          className={cn(
            'text-muted-foreground/60 ml-auto h-3 w-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="border-border/50 min-w-0 space-y-2 border-t px-3 pt-2 pb-3">
          {part.input != null && (
            <div className="min-w-0">
              <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                Input
              </p>
              <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
                {typeof part.input === 'string'
                  ? part.input
                  : JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {isDone && part.output != null && (
            <div className="min-w-0">
              <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                Output
              </p>
              <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
                {typeof part.output === 'string'
                  ? part.output
                  : JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Chat Message ─────────────────────────────────────────────────

interface ChatMessageProps {
  msg: ChatMsg
  isLastAssistant: boolean
  isRunning: boolean
  onSpeak?: (text: string) => void
  isSpeaking?: boolean
  avatarClassName?: string
  avatarTextClassName?: string
}

export function ChatMessage({
  msg,
  isLastAssistant,
  isRunning,
  onSpeak,
  isSpeaking,
  avatarClassName = 'bg-primary/15',
  avatarTextClassName = 'text-primary',
}: ChatMessageProps) {
  const isUser = msg.role === 'user'
  const textContent = extractTextContent(msg)
  const fileParts = msg.parts.filter(
    (p): p is { type: 'file'; mediaType: string; url: string } =>
      p.type === 'file',
  )

  // ── User message ──────────────────────────────────────────────
  if (isUser) {
    if (textContent.trim() === '' && fileParts.length === 0) return null

    return (
      <div className="flex justify-end gap-2">
        <div
          className={cn(
            'flex max-w-[85%] flex-col',
            fileParts.length > 0 ? 'items-end gap-1.5' : 'gap-1',
          )}
        >
          {fileParts.map((fp) => (
            <div
              key={fp.url.slice(-20)}
              className="border-border overflow-hidden rounded-xl border shadow-sm"
            >
              <Image
                src={fp.url}
                alt="Attached image"
                width={200}
                height={160}
                className="bg-muted/20 max-h-40 max-w-[200px] object-contain"
                unoptimized
              />
            </div>
          ))}
          <div className="bg-primary rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
            <span className="whitespace-pre-wrap">{textContent}</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Assistant message — render parts in order ────────────────
  const hasContent = msg.parts.some(
    (p) =>
      (p.type === 'text' && p.text.trim() !== '') ||
      p.type === 'reasoning' ||
      p.type === 'file' ||
      hasToolCallId(p),
  )
  if (!hasContent) return null

  return (
    <div className="flex items-start justify-start gap-2">
      <div
        className={cn(
          'ring-border/50 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
          avatarClassName,
        )}
      >
        <span className={cn('text-[10px] font-bold', avatarTextClassName)}>
          AI
        </span>
      </div>
      <div className="flex max-w-[85%] min-w-0 flex-col gap-2 overflow-hidden">
        {msg.parts.map((part, i) => {
          if (part.type === 'reasoning') {
            return (
              <ReasoningBlock
                key={`r-${i}`}
                text={part.text}
                isStreaming={
                  isLastAssistant && isRunning && part.state === 'streaming'
                }
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
                <Streamdown animated isAnimating={isLastAssistant && isRunning}>
                  {part.text}
                </Streamdown>
              </div>
            )
          }

          if (part.type === 'file') {
            return (
              <div
                key={`f-${part.url.slice(-20)}`}
                className="border-border overflow-hidden rounded-xl border"
              >
                <Image
                  src={part.url}
                  alt="Attached image"
                  width={200}
                  height={160}
                  className="bg-muted/20 max-h-40 max-w-[200px] object-contain"
                  unoptimized
                />
              </div>
            )
          }

          if (hasToolCallId(part)) {
            return (
              <ToolCallBlock
                key={`tc-${part.toolCallId}`}
                part={part as unknown as ToolPartShape}
              />
            )
          }

          return null
        })}

        {onSpeak && textContent.trim() && (
          <button
            type="button"
            onClick={() => onSpeak(textContent)}
            disabled={isSpeaking}
            className={cn(
              'text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 px-1 text-xs transition-colors',
              isSpeaking && 'text-primary',
            )}
          >
            {isSpeaking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
            {isSpeaking ? 'Speaking…' : 'Listen'}
          </button>
        )}
      </div>
    </div>
  )
}

interface ThinkingIndicatorProps {
  avatarClassName?: string
  avatarTextClassName?: string
}

export function ThinkingIndicator({
  avatarClassName = 'bg-primary/15',
  avatarTextClassName = 'text-primary',
}: ThinkingIndicatorProps) {
  return (
    <div className="flex items-start justify-start gap-2">
      <div
        className={cn(
          'ring-border/50 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
          avatarClassName,
        )}
      >
        <span className={cn('text-[10px] font-bold', avatarTextClassName)}>
          AI
        </span>
      </div>
      <div className="flex items-center gap-1 px-2 py-3">
        <span className="bg-muted-foreground/60 inline-block h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
        <span className="bg-muted-foreground/60 inline-block h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
        <span className="bg-muted-foreground/60 inline-block h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
      </div>
    </div>
  )
}
