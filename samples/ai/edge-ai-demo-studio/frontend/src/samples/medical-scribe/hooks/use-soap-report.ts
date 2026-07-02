// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useEffect, useRef } from 'react'
import { stripMarkdownFence } from '../utils'

export const SOAP_SYSTEM_PROMPT = `You are a medical scribe AI assistant. Given a doctor-patient dialogue transcript, generate a comprehensive SOAP note.

Format the note in Markdown with the following sections:

## Subjective
Patient's reported symptoms, concerns, and medical history as described in the dialogue.

## Objective
Observable findings, vital signs, and examination results mentioned by the doctor.

## Assessment
Doctor's clinical assessment, diagnoses, and differential diagnoses discussed.

## Plan
Treatment plan, medications, follow-up appointments, and any referrals mentioned.

Be thorough but concise. Only include information explicitly mentioned in the dialogue. If a section has no relevant information, note "No information provided in this encounter."`

interface SoapReportOptions {
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  disableReasoning?: boolean
  onFinish?: (text: string) => void
}

export function useSoapReport(options: SoapReportOptions = {}) {
  const { temperature = 0.3, maxTokens = 2048 } = options

  const onFinishRef = useRef(options.onFinish)
  useEffect(() => {
    onFinishRef.current = options.onFinish
  })

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/text-generation/chat',
    }),
  })

  const isGenerating = status === 'submitted' || status === 'streaming'

  const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')
  const lastAssistantMessageRef = useRef(lastAssistantMessage)
  useEffect(() => {
    lastAssistantMessageRef.current = lastAssistantMessage
  })

  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      const msg = lastAssistantMessageRef.current
      if (msg) {
        const text = msg.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (text) {
          onFinishRef.current?.(stripMarkdownFence(text))
        }
      }
    }
    wasGeneratingRef.current = isGenerating
  }, [isGenerating])

  const generate = useCallback(
    (dialogue: string) => {
      setMessages([])
      sendMessage(
        { text: dialogue },
        {
          body: {
            systemPrompt: options.systemPrompt || SOAP_SYSTEM_PROMPT,
            temperature,
            maxTokens,
            disableReasoning: options.disableReasoning,
          },
        },
      )
    },
    [
      sendMessage,
      setMessages,
      temperature,
      maxTokens,
      options.systemPrompt,
      options.disableReasoning,
    ],
  )

  const reset = useCallback(() => {
    setMessages([])
  }, [setMessages])

  return {
    generate,
    reset,
    isGenerating,
    status,
    message: lastAssistantMessage,
  }
}
