// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useEffect, useState } from 'react'
import type { TextGenParamValues } from './use-params'

interface UseTextGenChatOptions {
  textGenValues: TextGenParamValues
  /** Numeric sampling params the user has changed; untouched ones are omitted. */
  requestParams: Partial<
    Pick<
      TextGenParamValues,
      'maxTokens' | 'temperature' | 'topP' | 'topK' | 'repetitionPenalty'
    >
  >
  /** Extra body fields merged into every sendMessage call */
  extraBody?: Record<string, unknown>
}

export function useTextGenChat({
  textGenValues,
  requestParams,
  extraBody,
}: UseTextGenChatOptions) {
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/text-generation/chat',
    }),
  })
  const isRunning = status === 'submitted' || status === 'streaming'

  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
    },
    [],
  )

  const handleRemoveImage = useCallback(() => {
    // The imagePreview effect cleanup revokes the object URL on change/unmount.
    setImageFile(null)
    setImagePreview(null)
  }, [])

  // Revoke the previous preview object URL when it changes or on unmount,
  // so selecting a replacement image doesn't leak the prior blob: URL.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  const handleSend = useCallback(() => {
    if (!input.trim() || isRunning) return
    let files: FileList | undefined
    if (imageFile) {
      const dt = new DataTransfer()
      dt.items.add(imageFile)
      files = dt.files
    }
    sendMessage(
      {
        text: input,
        ...(files ? { files } : {}),
      },
      {
        body: {
          ...requestParams,
          ...(textGenValues.systemPrompt.trim()
            ? { systemPrompt: textGenValues.systemPrompt.trim() }
            : {}),
          disableReasoning: textGenValues.disableReasoning,
          reasoningParser: textGenValues.reasoningParser,
          ...extraBody,
        },
      },
    )
    setInput('')
    handleRemoveImage()
  }, [
    input,
    isRunning,
    imageFile,
    sendMessage,
    handleRemoveImage,
    textGenValues,
    requestParams,
    extraBody,
  ])

  const handleReset = useCallback(() => {
    setMessages([])
    handleRemoveImage()
  }, [setMessages, handleRemoveImage])

  return {
    messages,
    status,
    isRunning,
    input,
    setInput,
    imageFile,
    imagePreview,
    handleImageSelect,
    handleRemoveImage,
    handleSend,
    handleReset,
    handleStop: stop,
  }
}
