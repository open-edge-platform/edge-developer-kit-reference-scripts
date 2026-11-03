// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useSampleInstancesBody } from '@/context/sample-instances-context'
import {
  describeChatError,
  extractTextContent,
} from '@/services/text-generation/lib/chat-helpers'
import type {
  RequestParams,
  TextGenParamValues,
} from '@/services/text-generation/hooks/use-params'
import {
  CHAT_API,
  chatRequestBody,
} from '@/services/text-generation/lib/chat-request'
import { SOAP_SYSTEM_PROMPT, stripMarkdownFence } from '../lib/soap'

interface SoapReportOptions {
  /** The Parameters sheet's Text Generation settings. */
  textGenValues: TextGenParamValues
  requestParams: RequestParams
  /** Called with the finished note — never with one that failed part-way. */
  onFinish?: (text: string) => void
}

/** The shared chat body plus bound instances; the SOAP prompt when the system prompt is empty. */
function soapRequestBody(
  values: TextGenParamValues,
  requestParams: RequestParams,
  sampleInstances: object | undefined,
) {
  return {
    ...chatRequestBody(values, requestParams),
    systemPrompt: values.systemPrompt.trim() || SOAP_SYSTEM_PROMPT,
    ...sampleInstances,
  }
}

const soapTransport = new DefaultChatTransport({ api: CHAT_API })

/** A SOAP note written from a consultation's dialogue, streamed. */
export function useSoapReport({
  textGenValues,
  requestParams,
  onFinish,
}: SoapReportOptions) {
  const { messages, sendMessage, status, setMessages, error, clearError } =
    useChat({
      transport: soapTransport,
      // Called once per request however it ended; a broken or stopped stream is not saved.
      onFinish: ({ message, isAbort, isError }) => {
        if (isAbort || isError) return
        const text = extractTextContent(message)
        if (text) onFinish?.(stripMarkdownFence(text))
      },
    })
  // The Text Generation instance this sample binds, for the chat route.
  const sampleInstances = useSampleInstancesBody()

  const generate = (dialogue: string) => {
    setMessages([])
    clearError()
    sendMessage(
      { text: dialogue },
      {
        body: soapRequestBody(textGenValues, requestParams, sampleInstances),
      },
    )
  }

  const reset = () => {
    setMessages([])
    clearError()
  }

  return {
    generate,
    reset,
    isGenerating: status === 'submitted' || status === 'streaming',
    status,
    message: messages.findLast((m) => m.role === 'assistant'),
    /** Why the last report failed, until the next one is asked for. */
    error: error ? describeChatError(error) : null,
  }
}
