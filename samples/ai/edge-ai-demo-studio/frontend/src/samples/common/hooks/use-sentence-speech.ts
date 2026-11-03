// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import { SentenceProcessor } from '@/lib/llm/sentence-processor'
import type {
  ChatMsg,
  ChatStatus,
} from '@/services/text-generation/lib/chat-helpers'
import { extractTextContent } from '@/services/text-generation/lib/chat-helpers'

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
 * Splits the streaming assistant reply into sentences for progressive TTS. Layout effects hand over
 * the last sentence in the commit that ends the reply, so a caller never paints a frame showing the
 * reply as neither streaming nor being spoken.
 */
export function useSentenceSpeech({
  messages,
  status,
  onSentence,
  onComplete,
  enabled = true,
}: UseSentenceSpeechOptions) {
  const processedLengthRef = useRef(0)
  const processorRef = useRef<SentenceProcessor | null>(null)
  const prevMessageIdRef = useRef<string | null>(null)
  const flushedRef = useRef(false)

  const processor = () => (processorRef.current ??= new SentenceProcessor())

  const speak = useEffectEvent((sentences: string[]) => {
    for (const sentence of sentences) onSentence(sentence)
  })
  const complete = useEffectEvent(() => onComplete?.())

  /** Tracks from the reply on screen, never speaking what it already says; `finished`: no flush. */
  const skipCurrentReply = (finished: boolean) => {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role !== 'assistant') return false
    processorRef.current = new SentenceProcessor()
    prevMessageIdRef.current = lastMsg.id
    processedLengthRef.current = extractTextContent(lastMsg).length
    flushedRef.current = finished
    return true
  }

  // On re-enable, skip past the current reply so stale content is not re-spoken.
  const prevEnabledRef = useRef(enabled)
  const fastForward = useEffectEvent(() => {
    skipCurrentReply(status !== 'streaming')
  })
  useLayoutEffect(() => {
    if (prevEnabledRef.current === enabled) return
    prevEnabledRef.current = enabled
    if (enabled) fastForward()
  }, [enabled])

  // Process new text chunks as the streaming message grows
  useLayoutEffect(() => {
    if (!enabled) return

    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    if (lastMsg.id !== prevMessageIdRef.current) {
      prevMessageIdRef.current = lastMsg.id
      processedLengthRef.current = 0
      processorRef.current = new SentenceProcessor()
      flushedRef.current = false
    }

    if (flushedRef.current) return

    const text = extractTextContent(lastMsg)
    const newText = text.slice(processedLengthRef.current)
    if (!newText) return

    processedLengthRef.current = text.length
    speak(processor().addTextChunk(newText))
  }, [messages, enabled])

  // Flush remaining text when streaming completes
  useLayoutEffect(() => {
    if (!enabled) return
    if (status !== 'ready') return
    if (flushedRef.current) return

    flushedRef.current = true
    speak(processor().flush())
    complete()
  }, [status, enabled])

  /**
   * Drops what is unspoken and finishes with the reply on screen, so a later render of the same
   * message (e.g. a stop marker) is not spoken; the next reply has a new id and is tracked afresh.
   */
  const reset = () => {
    processorRef.current = new SentenceProcessor()
    if (!skipCurrentReply(true)) {
      prevMessageIdRef.current = null
      processedLengthRef.current = 0
      flushedRef.current = false
    }
  }

  return { reset }
}
