// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  Loader2,
  MessageSquare,
  RotateCcw,
  Square,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  type ChatMsg,
  type ChatStatus,
  handleChatKeyDown,
  isLastMessageLoading,
} from '@/services/text-generation/lib/chat-helpers'
import { ThinkingIndicator } from '@/services/text-generation/components/chat-message'

// ── ReAct text parser ────────────────────────────────────────────────────────

type ReActBlock =
  | { type: 'thought'; text: string }
  | { type: 'action'; name: string; input: string }
  | { type: 'answer'; text: string }

// Pseudo action names a model may emit when it decides no tool is needed.
const NO_TOOL_ACTIONS = new Set([
  '',
  '-',
  'n/a',
  'na',
  'none',
  'no tool',
  'null',
])

function isNoToolAction(name: string): boolean {
  return NO_TOOL_ACTIONS.has(
    name
      .replace(/[`'"*]/g, '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * Parses a ReAct-format agent response into structured blocks.
 * Handles Thought / Action / Action Input / Answer segments.
 * 'Action Input:' is matched before 'Action:' in the alternation to avoid
 * accidentally capturing the inner 'Action:' substring.
 */
function parseReActText(text: string): ReActBlock[] {
  if (!text.trim()) return []

  const regex = /(Thought:|Action Input:|Action:|Answer:)/g
  const tokens: Array<{ keyword: string; pos: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    tokens.push({ keyword: m[1], pos: m.index, end: m.index + m[1].length })
  }

  if (tokens.length === 0) return []

  const blocks: ReActBlock[] = []

  for (let i = 0; i < tokens.length; i++) {
    const { keyword, end } = tokens[i]
    const nextPos = i + 1 < tokens.length ? tokens[i + 1].pos : text.length
    // Strip any stray backtick fences that may appear between segments.
    const content = text.slice(end, nextPos).replace(/`{3}/g, '').trim()

    if (keyword === 'Thought:') {
      blocks.push({ type: 'thought', text: content })
    } else if (keyword === 'Action:') {
      const [firstLine, ...rest] = content.split('\n')
      const name = firstLine.trim()
      if (isNoToolAction(name)) {
        // "Action: None" followed by an unlabelled reply: show it as the answer.
        const reply = rest
          .filter((line) => !/^\s*Observation:/.test(line))
          .join('\n')
          .trim()
        if (reply) blocks.push({ type: 'answer', text: reply })
      } else {
        blocks.push({ type: 'action', name: content, input: '' })
      }
    } else if (keyword === 'Action Input:') {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'action') {
        blocks[blocks.length - 1] = { ...last, input: content }
      } else {
        blocks.push({ type: 'action', name: '', input: content })
      }
    } else if (keyword === 'Answer:') {
      blocks.push({ type: 'answer', text: content })
    }
  }

  // Merge thoughts left adjacent once pseudo actions are hidden.
  const merged: ReActBlock[] = []
  for (const b of blocks) {
    if (b.type === 'action' && isNoToolAction(b.name)) continue
    const last = merged[merged.length - 1]
    if (b.type === 'thought' && last?.type === 'thought') {
      merged[merged.length - 1] = {
        type: 'thought',
        text: `${last.text}\n\n${b.text}`.trim(),
      }
    } else {
      merged.push(b)
    }
  }
  return merged
}

// ── ThoughtBlock ─────────────────────────────────────────────────────────────

function ThoughtBlock({
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
    <div className="border-border/50 bg-primary/5 border-l-primary/60 max-w-full overflow-hidden rounded-xl border-l-2">
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
        <span className="text-primary font-medium">
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
          <div
            ref={scrollRef}
            className="min-w-0 overflow-auto"
            style={{ maxHeight: '100px' }}
          >
            <span className="break-words whitespace-pre-wrap">{text}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ActionBlock ──────────────────────────────────────────────────────────────

function ActionBlock({
  name,
  input,
  isStreaming,
}: {
  name: string
  input: string
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const displayName = name
    ? name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Tool Call'

  let prettyInput = input
  try {
    if (input) prettyInput = JSON.stringify(JSON.parse(input), null, 2)
  } catch {
    // keep raw input as-is
  }

  return (
    <div
      className={cn(
        'border-border/50 bg-muted/20 max-w-full overflow-hidden rounded-xl border-l-2',
        isStreaming ? 'border-l-blue-500/60' : 'border-l-emerald-500/60',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-muted/30 flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
      >
        {isStreaming ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/15">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-3 w-3 text-emerald-500" />
          </div>
        )}
        <span className="text-foreground min-w-0 truncate font-medium">
          {displayName}
        </span>
        {isStreaming ? (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            running
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            completed
          </span>
        )}
        <ChevronRight
          className={cn(
            'text-muted-foreground/60 ml-auto h-3 w-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && prettyInput && (
        <div className="border-border/50 min-w-0 space-y-2 border-t px-3 pt-2 pb-3">
          <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
            Input
          </p>
          <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
            {prettyInput}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── AgentChatMessage ─────────────────────────────────────────────────────────

function AgentChatMessage({
  msg,
  isLastAssistant,
  isRunning,
}: {
  msg: ChatMsg
  isLastAssistant: boolean
  isRunning: boolean
}) {
  const isUser = msg.role === 'user'

  if (isUser) {
    const textContent = msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    const fileParts = msg.parts.filter(
      (p): p is { type: 'file'; mediaType: string; url: string } =>
        p.type === 'file',
    )
    if (!textContent.trim() && fileParts.length === 0) return null

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

  // Assistant message — extract raw text then parse for ReAct structure
  const rawText = msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')

  if (!rawText.trim()) return null

  const blocks = parseReActText(rawText)
  const isStreaming = isLastAssistant && isRunning

  // No ReAct keywords detected — render as plain markdown text
  if (blocks.length === 0) {
    return (
      <div className="flex items-start justify-start gap-2">
        <div className="bg-primary/15 ring-border/50 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
          <span className="text-primary text-[10px] font-bold">AI</span>
        </div>
        <div
          className="text-foreground max-w-[85%] min-w-0 text-sm leading-relaxed"
          data-testid="assistant-message"
        >
          <Streamdown animated isAnimating={isStreaming}>
            {rawText}
          </Streamdown>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-start gap-2">
      <div className="bg-primary/15 ring-border/50 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
        <span className="text-primary text-[10px] font-bold">AI</span>
      </div>
      <div className="flex max-w-[85%] min-w-0 flex-col gap-2 overflow-hidden">
        {blocks.map((block, i) => {
          const isLastBlock = i === blocks.length - 1
          if (block.type === 'thought') {
            return (
              <ThoughtBlock
                key={`thought-${i}`}
                text={block.text}
                isStreaming={isStreaming && isLastBlock}
              />
            )
          }
          if (block.type === 'action') {
            return (
              <ActionBlock
                key={`action-${i}`}
                name={block.name}
                input={block.input}
                isStreaming={isStreaming && isLastBlock}
              />
            )
          }
          if (block.type === 'answer') {
            return (
              <div
                key={`answer-${i}`}
                className="text-foreground text-sm leading-relaxed"
                data-testid="assistant-message"
              >
                <Streamdown animated isAnimating={isStreaming && isLastBlock}>
                  {block.text}
                </Streamdown>
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

// ── AgentConversationPanel ───────────────────────────────────────────────────

interface AgentConversationPanelProps {
  messages: ChatMsg[]
  status: ChatStatus
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onReset: () => void
  placeholder?: string
  emptyStateText?: string
  messagesClassName?: string
  className?: string
}

export function AgentConversationPanel({
  messages,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onReset,
  placeholder = 'Type a message…',
  emptyStateText = 'Start a conversation',
  messagesClassName,
  className,
}: AgentConversationPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isRunning = status === 'submitted' || status === 'streaming'

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
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="text-muted-foreground/40 mb-3 h-10 w-10" />
            <p className="text-muted-foreground text-sm">{emptyStateText}</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <AgentChatMessage
              key={msg.id}
              msg={msg}
              isLastAssistant={msg.role !== 'user' && i === messages.length - 1}
              isRunning={isRunning}
            />
          ))
        )}

        {(status === 'submitted' ||
          (status === 'streaming' && isLastMessageLoading(messages))) && (
          <ThinkingIndicator />
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-border border-t p-3">
        {messages.length > 0 && (
          <div className="mb-2 flex items-center gap-1.5">
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
          </div>
        )}

        <div className="bg-muted/30 border-input focus-within:border-ring focus-within:ring-ring/50 relative rounded-md border shadow-xs focus-within:ring-[3px]">
          <Textarea
            data-testid="chat-input"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => handleChatKeyDown(e, onSend)}
            placeholder={placeholder}
            disabled={isRunning}
            rows={1}
            className="field-sizing-fixed !min-h-9 resize-none border-none pr-12 text-sm shadow-none focus-visible:ring-0"
          />
          {isRunning && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="destructive"
              className="absolute top-1 right-1.5 bottom-1.5 h-7 w-7"
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              onClick={onSend}
              size="icon"
              disabled={!input.trim() || isRunning}
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
