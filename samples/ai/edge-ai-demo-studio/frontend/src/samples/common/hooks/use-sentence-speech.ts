// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef } from 'react'
import { SentenceProcessor } from '@/lib/sentence-processor'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/components/chat-helpers'
import { extractTextContent } from '@/services/text-generation/components/chat-helpers'

interface UseSentenceSpeechOptions {
  messages: ChatMsg[]
  status: ChatStatus
  /** Called with each completed sentence during streaming */
  onSentence: (sentence: string) => void
  /** Called when all sentences (including final flush) have been dispatched */
  onComplete?: () => void
  /** Set to false to disable processing (e.g. when TTS is offline) */
  enabled?: boolean
}

/**
 * Watches streaming chat messages and splits the assistant's response into
 * sentences in real-time using `SentenceProcessor`. Calls `onSentence` for
 * each completed sentence, enabling progressive TTS playback.
 */
export function useSentenceSpeech({
  messages,
  status,
  onSentence,
  onComplete,
  enabled = true,
}: UseSentenceSpeechOptions) {
  const processedLengthRef = useRef(0)
  const processorRef = useRef<SentenceProcessor>(new SentenceProcessor())
  const prevMessageIdRef = useRef<string | null>(null)
  const flushedRef = useRef(false)

  // Store callbacks in refs so they never cause effect re-runs
  const onSentenceRef = useRef(onSentence)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onSentenceRef.current = onSentence
    onCompleteRef.current = onComplete
  }, [onSentence, onComplete])

  // Mirror latest messages/status into refs for use in transition effects
  const messagesRef = useRef(messages)
  const statusRef = useRef(status)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    statusRef.current = status
  }, [status])

  // When enabled transitions false → true, fast-forward the tracked state to
  // the current assistant message so stale content is not re-spoken.
  const prevEnabledRef = useRef(enabled)
  useEffect(() => {
    if (prevEnabledRef.current === enabled) return
    prevEnabledRef.current = enabled

    if (enabled) {
      const msgs = messagesRef.current
      const lastMsg = msgs[msgs.length - 1]
      if (lastMsg?.role === 'assistant') {
        prevMessageIdRef.current = lastMsg.id
        processedLengthRef.current = extractTextContent(lastMsg).length
        processorRef.current = new SentenceProcessor()
        flushedRef.current = statusRef.current !== 'streaming'
      }
    }
  }, [enabled])

  // Process new text chunks as the streaming message grows
  useEffect(() => {
    if (!enabled) return

    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    // Reset processor when a new assistant message starts
    if (lastMsg.id !== prevMessageIdRef.current) {
      prevMessageIdRef.current = lastMsg.id
      processedLengthRef.current = 0
      processorRef.current = new SentenceProcessor()
      flushedRef.current = false
    }

    // Don't re-process after flush
    if (flushedRef.current) return

    const text = extractTextContent(lastMsg)
    const newText = text.slice(processedLengthRef.current)
    if (!newText) return

    processedLengthRef.current = text.length

    const sentences = processorRef.current.addTextChunk(newText)
    for (const sentence of sentences) {
      onSentenceRef.current(sentence)
    }
  }, [messages, enabled])

  // Flush remaining text when streaming completes
  useEffect(() => {
    if (!enabled) return
    if (status !== 'ready') return
    if (flushedRef.current) return

    flushedRef.current = true

    const sentences = processorRef.current.flush()
    for (const sentence of sentences) {
      onSentenceRef.current(sentence)
    }

    onCompleteRef.current?.()
  }, [status, enabled])

  const reset = useCallback(() => {
    processedLengthRef.current = 0
    processorRef.current = new SentenceProcessor()
    prevMessageIdRef.current = null
    flushedRef.current = false
  }, [])

  return { reset }
}
