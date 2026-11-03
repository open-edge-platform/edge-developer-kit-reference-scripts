// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent } from 'react'
import type { useChat } from '@ai-sdk/react'

export type ChatMsg = ReturnType<typeof useChat>['messages'][number]
export type ChatStatus = ReturnType<typeof useChat>['status']

/** How a response ended early; kept in message metadata, which the chat route ignores. */
export type MessageOutcome = 'stopped' | 'interrupted'

export function extractTextContent(msg: ChatMsg): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** The last message has no visible content yet. */
export function isLastMessageLoading(messages: ChatMsg[]): boolean {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg) return false
  return !lastMsg.parts.some(
    (p) =>
      ((p.type === 'text' || p.type === 'reasoning') && p.text.trim() !== '') ||
      'toolCallId' in p,
  )
}

export function getMessageOutcome(msg: ChatMsg): MessageOutcome | undefined {
  const metadata = msg.metadata
  if (metadata == null || typeof metadata !== 'object') return undefined
  const outcome = (metadata as { outcome?: unknown }).outcome
  return outcome === 'stopped' || outcome === 'interrupted'
    ? outcome
    : undefined
}

/**
 * Marks response `responseId` with its outcome. A response stopped before any output never reached
 * the list, so the user message it answered carries the label instead.
 */
export function withOutcome<M extends ChatMsg>(
  messages: M[],
  responseId: string,
  outcome: MessageOutcome,
): M[] {
  let index = messages.findIndex((m) => m.id === responseId)
  if (index === -1 && outcome === 'stopped') {
    const last = messages.length - 1
    if (messages[last]?.role === 'user') index = last
  }
  if (index === -1) return messages
  const target = messages[index]
  const metadata =
    target.metadata != null && typeof target.metadata === 'object'
      ? target.metadata
      : {}
  return messages.map((m, i) =>
    i === index ? { ...m, metadata: { ...metadata, outcome } } : m,
  )
}

/** Send on Enter, newline on Shift+Enter. */
export function handleChatKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  onSend: () => void,
) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

/** The transport reports a non-OK response by its body, often `{ "error": "…" }`. */
export function describeChatError(error: Error): string {
  const message = error.message.trim()
  try {
    const parsed: unknown = JSON.parse(message)
    if (parsed && typeof parsed === 'object') {
      const detail =
        (parsed as { error?: unknown; message?: unknown }).error ??
        (parsed as { message?: unknown }).message
      if (typeof detail === 'string' && detail.trim()) return detail.trim()
    }
  } catch {
    // Not JSON: use the text as is.
  }
  return message || 'The request failed.'
}

/** Images attached to a draft message. */
export interface ChatAttachments {
  /** Preview URLs, in order. */
  previews: string[]
  attach: (files: File[]) => void
  remove: (index: number) => void
}
