// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent } from 'react'
import type { useChat } from '@ai-sdk/react'

export type ChatMsg = ReturnType<typeof useChat>['messages'][number]
export type ChatStatus = ReturnType<typeof useChat>['status']

/** Extract concatenated text content from a chat message's parts */
export function extractTextContent(msg: ChatMsg): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** Check if the last message has no visible content yet (still loading) */
export function isLastMessageLoading(messages: ChatMsg[]): boolean {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg) return false
  return !lastMsg.parts.some(
    (p) =>
      (p.type === 'text' && p.text.trim() !== '') ||
      p.type === 'reasoning' ||
      'toolCallId' in p,
  )
}

/** Send on Enter, newline on Shift+Enter */
export function handleChatKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  onSend: () => void,
) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}
