// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useState } from 'react'

/**
 * Chat hook for the Exam Marking Agent service.
 * Streams responses from the ReAct agent via the Next.js API route
 * at /api/services/exam-marking-agent/chat.
 */
export function useExamAgentChat() {
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/exam-marking-agent/chat',
    }),
  })

  const [input, setInput] = useState('')
  const isRunning = status === 'submitted' || status === 'streaming'

  const handleSend = useCallback(() => {
    if (!input.trim() || isRunning) return
    sendMessage({ text: input.trim() })
    setInput('')
  }, [input, isRunning, sendMessage])

  const handleStop = useCallback(() => stop(), [stop])

  const handleReset = useCallback(() => setMessages([]), [setMessages])

  return {
    messages,
    status,
    isRunning,
    input,
    setInput,
    handleSend,
    handleStop,
    handleReset,
  }
}
